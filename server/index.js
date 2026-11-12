import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { REGIONS, getRegion } from './regions.js';
import { createMolitClient, DEAL_TYPES } from './molit.js';
import { createService, summarize, daysAgo } from './service.js';
import { createStore } from './store.js';
import { createPush } from './push.js';
import { createAlerts } from './alerts.js';
import { demoInjectDeal } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export function createApp(cfg = {}) {
  const {
    serviceKey = process.env.MOLIT_SERVICE_KEY || '',
    dataFile = process.env.DATA_FILE || path.join(ROOT, 'data', 'db.json'),
    complexMonths = Number(process.env.COMPLEX_MONTHS || 6),
    adminToken = process.env.ADMIN_TOKEN || '',
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT },
    now,
    pushImpl,
  } = cfg;

  const store = createStore(dataFile);
  const molit = cfg.molit || createMolitClient({ serviceKey, now });
  const service = createService(molit, { complexMonths });
  const push = pushImpl || createPush({ store, ...vapid });
  const alerts = createAlerts({ store, molit, service, push, now });
  const db = () => store.data;

  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const lawd = (req) => {
    const r = getRegion(req.params.lawd);
    if (!r) throw Object.assign(new Error('알 수 없는 시군구 코드'), { status: 404 });
    return r.code;
  };
  // 로그인 없이 기기별 익명 ID 사용 (클라이언트가 생성해 localStorage에 보관)
  const user = (req) => {
    const id = req.get('X-User-Id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error('X-User-Id 헤더가 필요합니다'), { status: 401 });
    return id;
  };

  // ---------- 공개 데이터 ----------
  app.get('/api/config', (req, res) => {
    res.json({ demo: molit.demo, vapidPublicKey: push.publicKey, lastPollAt: db().lastPollAt, dealTypes: DEAL_TYPES });
  });

  app.get('/api/regions', (req, res) => res.json(REGIONS));

  app.get('/api/regions/:lawd/complexes', wrap(async (req, res) => {
    const code = lawd(req);
    res.json({ region: getRegion(code), complexes: await service.getComplexes(code) });
  }));

  app.get('/api/complexes/:lawd/:id', wrap(async (req, res) => {
    const c = await service.getComplex(lawd(req), req.params.id);
    if (!c) return res.status(404).json({ error: '단지를 찾을 수 없습니다' });
    res.json({ ...c, region: getRegion(c.lawdCd) });
  }));

  app.get('/api/complexes/:lawd/:id/deals', wrap(async (req, res) => {
    const type = String(req.query.type || 'trade');
    if (!DEAL_TYPES[type]) return res.status(400).json({ error: 'type은 trade|jeonse|monthly' });
    const months = Math.min(Math.max(Number(req.query.months) || complexMonths, 1), 36);
    const deals = await service.getDeals(lawd(req), req.params.id, type, months);
    const since = daysAgo(30, now ? now() : new Date());
    res.json({ type, months, deals, summary30: summarize(deals.filter((d) => d.date >= since)), summaryAll: summarize(deals) });
  }));

  // ---------- 사용자별 ----------
  app.post('/api/push/subscribe', wrap(async (req, res) => {
    push.register(user(req), req.body);
    res.json({ ok: true });
  }));
  app.delete('/api/push/subscribe', wrap(async (req, res) => {
    push.unregister(user(req), req.body?.endpoint);
    res.json({ ok: true });
  }));
  app.post('/api/push/test', wrap(async (req, res) => {
    const n = await push.sendToUser(user(req), { title: '🔔 테스트 알림', body: '푸시 알림이 정상적으로 동작합니다.', url: '/#/alerts' });
    res.json({ ok: true, devices: n });
  }));

  app.get('/api/subscriptions', wrap(async (req, res) => {
    const uid = user(req);
    res.json(db().subscriptions.filter((s) => s.userId === uid).map(({ skipKeys, ...s }) => ({ ...s, region: getRegion(s.lawdCd) })));
  }));
  app.post('/api/subscriptions', wrap(async (req, res) => {
    const uid = user(req);
    const { lawdCd, complexId, type } = req.body || {};
    if (!getRegion(lawdCd)) return res.status(400).json({ error: 'lawdCd가 올바르지 않습니다' });
    const { subscription, recent } = await alerts.subscribe(uid, { lawdCd: String(lawdCd), complexId: String(complexId), type });
    const { skipKeys, ...s } = subscription;
    res.status(201).json({ subscription: s, recentCount: recent.length });
  }));
  app.delete('/api/subscriptions/:id', wrap(async (req, res) => {
    res.json({ ok: alerts.unsubscribe(user(req), req.params.id) });
  }));

  app.get('/api/notifications', wrap(async (req, res) => {
    const uid = user(req);
    const list = db().notifications.filter((n) => n.userId === uid).reverse().slice(0, 100);
    res.json({ unread: list.filter((n) => !n.read).length, notifications: list });
  }));
  app.post('/api/notifications/read-all', wrap(async (req, res) => {
    const uid = user(req);
    db().notifications.forEach((n) => { if (n.userId === uid) n.read = true; });
    store.save();
    res.json({ ok: true });
  }));

  // ---------- 관리 ----------
  app.post('/api/admin/poll', wrap(async (req, res) => {
    if (adminToken && req.get('X-Admin-Token') !== adminToken) return res.status(403).json({ error: 'forbidden' });
    const injected = [];
    // 데모 모드에서 ?inject=1 이면 구독 중인 모든 단지에 가짜 신규 거래를 하나씩 추가 (알림 체험용)
    if (molit.demo && req.query.inject) {
      const done = new Set();
      for (const s of db().subscriptions) {
        const k = `${s.lawdCd}|${s.aptNm}|${s.type}`;
        if (done.has(k)) continue;
        done.add(k);
        if (demoInjectDeal(s.lawdCd, s.aptNm, s.type, now ? now() : new Date())) injected.push(k);
      }
    }
    res.json({ injected, ...(await alerts.poll()) });
  }));

  // ---------- 정적 파일 (PWA) ----------
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    const status = err.status || 502;
    if (status >= 500) console.error('[error]', err.message);
    res.status(status).json({ error: err.message });
  });

  return { app, store, alerts, molit };
}

// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  const { app, alerts, molit, store } = createApp();
  const port = Number(process.env.PORT || 3000);
  const intervalMin = Number(process.env.POLL_INTERVAL_MINUTES || 180);

  app.listen(port, () => {
    console.log(`🏠 아파트 실거래가 알림 서버: http://localhost:${port}`);
    console.log(molit.demo ? '⚠️  MOLIT_SERVICE_KEY가 없어 데모 데이터로 동작합니다.' : '✅ 국토교통부 실거래가 API 사용');
    console.log(`⏱  ${intervalMin}분마다 새 실거래를 확인합니다.`);
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await alerts.poll();
      if (r.notificationsSent || r.errors.length) console.log('[poll]', JSON.stringify(r));
    } catch (e) {
      console.error('[poll] 오류:', e.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, intervalMin * 60_000);

  const shutdown = () => {
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
