// 알림 구독 · 신규 실거래 감지 · 푸시 발송
import crypto from 'node:crypto';
import { DEAL_TYPES, apiForType, recentYms } from './molit.js';
import { daysAgo } from './service.js';
import { formatDealLine } from './format.js';

const POLL_MONTHS = 2; // 신고기한 30일 → 이번 달 + 지난달 데이터만 계속 갱신됨
const MAX_NOTIFICATIONS_PER_USER = 300;

export function createAlerts({ store, molit, service, push, now = () => new Date(), log = console }) {
  const db = () => store.data;

  // ----- 알림(inbox + 푸시) -----
  async function notify(userId, sub, title, body, deals, kind) {
    const n = {
      id: crypto.randomUUID(),
      userId,
      subscriptionId: sub?.id || null,
      lawdCd: sub?.lawdCd,
      complexId: sub?.complexId,
      type: sub?.type,
      kind, // 'recent' | 'new' | 'canceled'
      title,
      body,
      deals,
      createdAt: now().toISOString(),
      read: false,
    };
    const list = db().notifications;
    list.push(n);
    const mine = list.filter((x) => x.userId === userId);
    if (mine.length > MAX_NOTIFICATIONS_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_NOTIFICATIONS_PER_USER).map((x) => x.id));
      db().notifications = list.filter((x) => !drop.has(x.id));
    }
    store.save();
    await push.sendToUser(userId, {
      title,
      body,
      tag: sub ? `sub-${sub.id}` : undefined,
      url: sub ? `/#/complex/${sub.lawdCd}/${sub.complexId}?type=${sub.type}` : '/#/alerts',
    });
    return n;
  }

  function bodyFor(deals) {
    const lines = deals.slice(0, 4).map(formatDealLine);
    if (deals.length > 4) lines.push(`외 ${deals.length - 4}건`);
    return lines.join('\n');
  }

  // ----- "본 거래" 기록 -----
  function seenFor(api, lawdCd) {
    return db().seen[`${api}:${lawdCd}`];
  }

  async function ensureBaseline(api, lawdCd) {
    if (seenFor(api, lawdCd)) return;
    const months = {};
    for (const ym of recentYms(POLL_MONTHS, now())) {
      const deals = await molit.fetchMonth(api, lawdCd, ym);
      months[ym] = Object.fromEntries(deals.map((d) => [d.key, d.canceled ? 'canceled' : 1]));
    }
    db().seen[`${api}:${lawdCd}`] = { initializedAt: now().toISOString(), months };
    store.save();
  }

  // ----- 구독 -----
  async function subscribe(userId, { lawdCd, complexId, type }) {
    if (!DEAL_TYPES[type]) throw Object.assign(new Error('type은 trade|jeonse|monthly 중 하나여야 합니다'), { status: 400 });
    const existing = db().subscriptions.find((s) => s.userId === userId && s.lawdCd === lawdCd && s.complexId === complexId && s.type === type);
    if (existing) return { subscription: existing, recent: [] };

    const complex = await service.getComplex(lawdCd, complexId);
    if (!complex) throw Object.assign(new Error('단지를 찾을 수 없습니다'), { status: 404 });

    const sub = {
      id: crypto.randomUUID(),
      userId,
      lawdCd,
      complexId,
      aptNm: complex.aptNm,
      umdNm: complex.umdNm,
      type,
      createdAt: now().toISOString(),
    };
    await ensureBaseline(apiForType(type), lawdCd);
    db().subscriptions.push(sub);
    store.save();

    // 최근 한 달 실거래 즉시 알림
    const since = daysAgo(30, now());
    const recent = (await service.getDeals(lawdCd, complexId, type, POLL_MONTHS)).filter((d) => d.date >= since);
    // 직전 폴링 이후 신고돼서 이미 '최근 한 달'로 보낸 거래는 다음 폴링 때 중복 알림하지 않음
    const months = seenFor(apiForType(type), lawdCd).months;
    sub.skipKeys = recent.filter((d) => !(d.key in (months[d.date.slice(0, 7).replace('-', '')] || {}))).map((d) => d.key);
    const label = `${complex.aptNm} ${DEAL_TYPES[type]}`;
    await notify(
      userId,
      sub,
      `🔔 ${label} 알림 시작`,
      recent.length ? `최근 한 달 실거래 ${recent.length}건\n${bodyFor(recent)}` : '최근 한 달간 신고된 실거래가 없습니다. 새 거래가 신고되면 알려드릴게요.',
      recent,
      'recent',
    );
    return { subscription: sub, recent };
  }

  function unsubscribe(userId, id) {
    const before = db().subscriptions.length;
    db().subscriptions = db().subscriptions.filter((s) => !(s.id === id && s.userId === userId));
    store.save();
    return db().subscriptions.length !== before;
  }

  // ----- 주기적 폴링: 새로 신고된 거래 / 해제된 거래 감지 -----
  async function poll() {
    const subs = db().subscriptions;
    const groups = new Map(); // `${api}:${lawd}` -> subs[]
    for (const s of subs) {
      const g = `${apiForType(s.type)}:${s.lawdCd}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    const yms = recentYms(POLL_MONTHS, now());
    let sent = 0;
    const errors = [];

    for (const [g, gsubs] of groups) {
      const [api, lawdCd] = g.split(':');
      try {
        await ensureBaseline(api, lawdCd);
        const rec = seenFor(api, lawdCd);
        const fresh = [];
        const canceled = [];
        const nextMonths = {};
        for (const ym of yms) {
          const deals = await molit.fetchMonth(api, lawdCd, ym, { force: true });
          const prev = rec.months[ym] || {};
          const cur = {};
          for (const d of deals) {
            cur[d.key] = d.canceled ? 'canceled' : 1;
            if (!(d.key in prev)) {
              if (!d.canceled) fresh.push(d);
            } else if (d.canceled && prev[d.key] !== 'canceled') {
              canceled.push(d);
            }
          }
          // 사라진 키는 다시 나타나도 재알림하지 않도록 유지
          for (const k of Object.keys(prev)) if (!(k in cur)) cur[k] = prev[k];
          nextMonths[ym] = cur;
        }
        rec.months = nextMonths; // 폴링 범위 밖(오래된 달)은 정리
        store.save();

        for (const s of gsubs) {
          const skip = new Set(s.skipKeys || []);
          delete s.skipKeys;
          const mine = fresh.filter((d) => d.complexId === s.complexId && d.type === s.type && !skip.has(d.key));
          const label = `${s.aptNm} ${DEAL_TYPES[s.type]}`;
          if (mine.length) {
            await notify(s.userId, s, `🏠 ${label} 새 실거래 ${mine.length}건`, bodyFor(mine), mine, 'new');
            sent++;
          }
          const myCanceled = canceled.filter((d) => d.complexId === s.complexId && d.type === s.type);
          if (myCanceled.length) {
            await notify(s.userId, s, `⚠️ ${label} 거래 해제 ${myCanceled.length}건`, bodyFor(myCanceled), myCanceled, 'canceled');
            sent++;
          }
        }
      } catch (e) {
        log.error(`[poll] ${g} 실패:`, e.message);
        errors.push({ group: g, error: e.message });
      }
    }
    // 구독이 없어진 지역의 기록 정리
    for (const k of Object.keys(db().seen)) if (!groups.has(k)) delete db().seen[k];
    db().lastPollAt = now().toISOString();
    store.save();
    return { groups: groups.size, notificationsSent: sent, errors };
  }

  return { subscribe, unsubscribe, poll, notify };
}
