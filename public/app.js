// 아파트 실거래 알리미 - 프런트엔드 (프레임워크 없는 SPA, 해시 라우팅)
const TYPES = { trade: '매매', jeonse: '전세', monthly: '월세' };
const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('backBtn');

// ---------- 유틸 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};
let userId = store.get('userId');
if (!userId) { userId = crypto.randomUUID(); store.set('userId', userId); }

// 안드로이드 앱 안에서는 서버 대신 네이티브 브리지(AndroidBridge)로 같은 API를 호출
const bridge = window.AndroidBridge;
const isApp = Boolean(bridge);
const pendingCalls = new Map();
let callSeq = 0;
window.__bridgeResolve = (id, json) => {
  const p = pendingCalls.get(id);
  if (!p) return;
  pendingCalls.delete(id);
  let r;
  try { r = JSON.parse(json); } catch { r = { status: 500, data: { error: '응답 오류' } }; }
  if (r.status >= 400) p.reject(new Error(r.data?.error || `요청 실패 (${r.status})`));
  else p.resolve(r.data);
};

async function api(path, opts = {}) {
  if (isApp) {
    return new Promise((resolve, reject) => {
      const id = ++callSeq;
      pendingCalls.set(id, { resolve, reject });
      bridge.request(id, opts.method || 'GET', path, opts.body ? JSON.stringify(opts.body) : '');
    });
  }
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

// ---------- 설정: 화면 디자인 적용 ----------
const ACCENTS = {
  blue: ['#2563eb', '#5b8cff', '파랑'], green: ['#059669', '#34d399', '초록'], teal: ['#0d9488', '#2dd4bf', '청록'],
  purple: ['#7c3aed', '#a78bfa', '보라'], pink: ['#db2777', '#f472b6', '분홍'], red: ['#dc2626', '#f87171', '빨강'],
  orange: ['#ea580c', '#fb923c', '주황'], navy: ['#1e3a8a', '#93a5f5', '남색'],
};
const DEFAULT_PREFS = {
  notiSound: true, soundName: '기본 알림음', notiVibrate: true, vibratePattern: 'short', notiPopup: true, notiCanceled: true,
  quietEnabled: false, quietStart: '22:00', quietEnd: '08:00', theme: 'system', accent: 'blue', fontScale: 100,
  notiColor: 'app', notiIcon: 'house', notiTitle: 'count', notiDetail: 'detail', notiLockscreen: 'show',
};
const NOTI_ICONS = {
  house: ['집', 'M4 21V10l8-6 8 6v11h-5v-6H9v6z'],
  building: ['아파트', 'M4 21V5h10v16h-3v-4H7v4zM6 7v2h2V7zM10 7v2h2V7zM6 11v2h2v-2zM10 11v2h2v-2zM16 21V10h4v11z'],
  bell: ['종', 'M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zM19 16v-5a7 7 0 0 0-5.5-6.8V3h-3v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z'],
  chart: ['그래프', 'M3 20h18v2H3zM4.5 16.5l4.5-5.5 3.5 3 5-7 2.5 1.8-7 9.7-3.5-3-3.1 3.8z'],
};
const iconSvg = (k, size = 12, color = '#fff') => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="${color}" fill-rule="evenodd" d="${(NOTI_ICONS[k] || NOTI_ICONS.house)[1]}"/></svg>`;
let prefs = { ...DEFAULT_PREFS };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('prefs') || '{}')); } catch { /* */ }
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance(p = prefs) {
  prefs = { ...DEFAULT_PREFS, ...p };
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* */ }
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  const [light, dark] = ACCENTS[prefs.accent] || ACCENTS.blue;
  root.style.setProperty('--accent-l', light);
  root.style.setProperty('--accent-d', dark);
  const isDark = prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light);
  if (window.AndroidBridge?.setAppearance) window.AndroidBridge.setAppearance(light, isDark, Number(prefs.fontScale) || 100);
  else if (document.body) document.body.style.zoom = (Number(prefs.fontScale) || 100) / 100;
}
darkQuery.addEventListener?.('change', () => applyAppearance());
applyAppearance();

// ---------- 아이콘 (선 아이콘, 글자 색을 따라감) ----------
const svg = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const IC = {
  pin: svg('<path class="f" d="M12 2.5a7 7 0 0 0-7 7c0 5 7 12 7 12s7-7 7-12a7 7 0 0 0-7-7z"/><circle cx="12" cy="9.5" r="2.6" fill="#fff"/>'),
  building: svg('<path class="f" d="M3 21V9l5-2v14zM9 21V4l7-1.5V21zM17 21V8l4 1.5V21z"/><path d="M11.5 7h2M11.5 10h2M11.5 13h2M11.5 16h2" stroke="#fff" stroke-width="1.4"/>'),
  bell: svg('<path class="f" d="M12 3a6 6 0 0 0-6 6v4.5L4 16.5V18h16v-1.5l-2-3V9a6 6 0 0 0-6-6zM9.8 19.5a2.3 2.3 0 0 0 4.4 0z"/>'),
  star: svg('<path class="f" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4.5v3h3M4 13a8 8 0 0 0 14.5 4.5M20 19.5v-3h-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  chev: svg('<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  check: svg('<path d="m5.5 12.5 4 4 9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
  megaphone: svg('<path class="f" d="M3 10v4l2 .5 1.5 5h2.5l-1-4.5L19 18V6L5 9.5z"/><path d="M21 9.5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
};
const THUMB = 'img/apt.jpg';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function won(v) {
  const n = Math.round(Number(v) || 0);
  const eok = Math.floor(n / 10000), rest = n % 10000;
  if (eok && rest) return `${eok}억 ${rest.toLocaleString()}`;
  if (eok) return `${eok}억`;
  return `${rest.toLocaleString()}만`;
}
const pyeong = (m2) => (m2 / 3.3058).toFixed(1);
const m2 = (a) => String(Math.round(Number(a) * 100) / 100); // 84.9329 → 84.93
const dealPrice = (d) => (d.type === 'trade' ? won(d.price) : d.type === 'jeonse' ? won(d.deposit) : `${won(d.deposit)} / 월${Number(d.monthlyRent).toLocaleString()}`);
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const loading = () => { $view.innerHTML = '<div class="spinner"></div>'; };
const errorHtml = (e) => `<div class="error">⚠️ ${esc(e.message)}${isApp && !config?.relayOnly && /키|연결|중계/.test(e.message) ? '<br><br><a class="btn primary" href="#/settings">⚙️ 연결 설정하러 가기</a>' : ''}</div>`;
const showError = (e) => { $view.innerHTML = errorHtml(e); };

function setHeader(title, back) {
  $title.textContent = title;
  document.title = title === '실거래 알리미' ? title : `${title} · 실거래 알리미`;
  $back.hidden = !back;
  $back.onclick = () => (history.length > 1 ? history.back() : (location.hash = back));
}

// ---------- 푸시 ----------
let config = null;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function ensurePush() {
  if (isApp) return (await api('/api/push/subscribe', { method: 'POST' })).granted;
  if (!pushSupported()) return false;
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(config.vapidPublicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return true;
}

async function refreshUnread() {
  try {
    const { unread } = await api('/api/notifications');
    const b = document.getElementById('unreadBadge');
    b.hidden = !unread;
    b.textContent = unread > 99 ? '99+' : unread;
  } catch { /* 무시 */ }
}

// ---------- 화면: 시군구 선택 ----------
let regionsCache;
async function viewHome() {
  setHeader('실거래 알리미');
  loading();
  regionsCache ||= await api('/api/regions');
  const sido = store.get('sido') || '서울특별시';
  const recent = JSON.parse(store.get('recentRegions') || '[]');
  const render = (selected) => {
    const r = regionsCache.find((x) => x.sido === selected) || regionsCache[0];
    const current = recent[0]?.code;
    $view.innerHTML = `
      <div class="sheet">
      ${isApp && !config.hasKey ? '<a class="banner" href="#/settings">👉 먼저 ⚙️ 설정에서 데이터 연결을 설정해 주세요</a>' : ''}
      ${recent.length ? `<h3 class="sec">${IC.pin}최근 본 지역</h3>
        <div class="chips pill-row">${recent.map((x) => `<a class="chip" href="#/region/${x.code}">${esc(x.name)}</a>`).join('')}</div>` : ''}
      <div class="sido-box">
        <h3 class="sec">${IC.building}시·도</h3>
        <div class="chips" id="sidoChips">${regionsCache.map((x) => `<button class="chip ${x.sido === r.sido ? 'active' : ''}" data-sido="${esc(x.sido)}">${esc(x.sido)}${x.sido === r.sido ? IC.check : ''}</button>`).join('')}</div>
      </div>
      <h3 class="sec">${IC.pin}시·군·구</h3>
      <div class="grid region-grid">${r.sigungu.map((x) => `<a href="#/region/${x.code}" class="${x.code === current ? 'current' : ''}">${esc(x.name)}${x.code === current ? `<span class="ck">${IC.check}</span>` : ''}</a>`).join('')}</div>
      <a class="promo" href="#/alerts">
        <span class="promo-ic">${IC.megaphone}</span>
        <span>관심 지역을 선택하고<br />실거래가 알림을 받아보세요!</span>
        <span class="round-chev">${IC.chev}</span>
      </a>
      </div>`;
    $view.querySelector('#sidoChips .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    $view.querySelectorAll('[data-sido]').forEach((b) => (b.onclick = () => { store.set('sido', b.dataset.sido); render(b.dataset.sido); }));
  };
  render(sido);
}

// ---------- 화면: 단지 목록 ----------
async function viewRegion(lawd) {
  setHeader('단지 목록', '#/');
  loading();
  const { region, complexes } = await api(`/api/regions/${lawd}/complexes`);
  setHeader(region.name, '#/');
  const recent = JSON.parse(store.get('recentRegions') || '[]').filter((x) => x.code !== region.code);
  store.set('recentRegions', JSON.stringify([{ code: region.code, name: region.name }, ...recent].slice(0, 6)));

  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } },
  };
  // 동(법정동)별 단지 수 → 가나다순 버튼
  const dongCount = new Map();
  for (const c of complexes) dongCount.set(c.umdNm, (dongCount.get(c.umdNm) || 0) + 1);
  const dongs = [...dongCount.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  let dong = ss.get(`dong:${lawd}`) || '';
  if (dong && !dongCount.has(dong)) dong = '';

  $view.innerHTML = `
    <div class="chips dong-chips" id="dongChips">
      <button class="chip ${dong ? '' : 'active'}" data-dong="">전체 <small>${complexes.length}</small></button>
      ${dongs.map((d) => `<button class="chip ${d === dong ? 'active' : ''}" data-dong="${esc(d)}">${esc(d)} <small>${dongCount.get(d)}</small></button>`).join('')}
    </div>
    <input class="search" type="search" placeholder="단지명 검색" value="${esc(ss.get(`q:${lawd}`) || '')}" aria-label="단지 검색" />
    <div class="meta" id="count" style="margin:0 4px 8px"></div>
    <div class="list" id="list"></div>`;
  const $list = $view.querySelector('#list');
  const $input = $view.querySelector('.search');
  const draw = () => {
    const term = $input.value.trim().replace(/\s+/g, '');
    ss.set(`q:${lawd}`, $input.value);
    ss.set(`dong:${lawd}`, dong);
    $view.querySelectorAll('[data-dong]').forEach((b) => b.classList.toggle('active', b.dataset.dong === dong));
    const items = complexes.filter((c) => (!dong || c.umdNm === dong) && (!term || `${c.aptNm}${c.umdNm}`.replace(/\s+/g, '').includes(term)));
    $view.querySelector('#count').textContent = `${dong ? `${region.name} ${dong}` : `${region.name} 전체`} · 최근 거래가 있는 단지 ${items.length}곳`;
    $list.innerHTML = items.length
      ? items.map((c) => `
        <a class="card cx-card" href="#/complex/${lawd}/${c.id}">
          <img class="thumb sm" src="${THUMB}" alt="" loading="lazy" />
          <span class="cx-main">
            <span class="card-row"><h3>${esc(c.aptNm)}</h3>${c.lastTradePrice ? `<span class="price num">${won(c.lastTradePrice)}</span>` : ''}</span>
            <span class="card-row meta"><span>${esc(c.umdNm)} ${esc(c.jibun)}${c.buildYear ? ` · ${c.buildYear}년` : ''}</span>${c.lastTradeDate ? `<span>${c.lastTradeDate.slice(2).replace(/-/g, '.')} 매매</span>` : ''}</span>
            <span class="counts">${Object.entries(TYPES).map(([t, l]) => `<span class="tag ${t}">${l} ${c.counts[t]}</span>`).join('')}</span>
          </span>
        </a>`).join('')
      : '<div class="empty">검색 결과가 없습니다</div>';
  };
  $view.querySelectorAll('[data-dong]').forEach((b) => (b.onclick = () => {
    dong = b.dataset.dong;
    draw();
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }));
  $input.oninput = draw;
  draw();
  $view.querySelector('#dongChips .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- 화면: 단지 상세 ----------
async function viewComplex(lawd, id, params) {
  setHeader('단지 정보', `#/region/${lawd}`);
  loading();
  const [complex, subs, inboxRes] = await Promise.all([
    api(`/api/complexes/${lawd}/${id}`), api('/api/subscriptions'), api('/api/notifications').catch(() => ({ notifications: [] })),
  ]);
  setHeader(complex.aptNm, `#/region/${lawd}`);
  let type = TYPES[params.get('type')] ? params.get('type') : 'trade';
  let area = 'all';
  // 최근 7일 안에 '새 실거래'로 알림 받은 거래 → NEW 표시
  const weekAgo = Date.now() - 7 * 86400000;
  const mine = inboxRes.notifications.filter((n) => n.complexId === id && n.lawdCd === lawd);
  const newDeals = mine.filter((n) => n.kind === 'new' && new Date(n.createdAt) >= weekAgo).flatMap((n) => n.deals || []);
  const newKeys = new Set(newDeals.map((d) => d.key));
  const newTypes = new Set(newDeals.map((d) => d.type));
  // 알림(n=알림ID) 또는 알림함 거래 줄(focus=거래키)에서 들어오면 그 거래로 이동
  let focusKey = params.get('focus') || '';
  const fromNoti = params.get('n') && mine.find((n) => n.id === params.get('n'));
  if (!focusKey && fromNoti) {
    const ds = (fromNoti.deals || []).filter((d) => d.type === type);
    if (ds.length) focusKey = ds[0].key;
    (fromNoti.deals || []).forEach((d) => { newKeys.add(d.key); newTypes.add(d.type); });
  }
  if (focusKey) newKeys.add(focusKey);

  $view.innerHTML = `
    <div class="card cx-hero">
      <img class="thumb" src="${THUMB}" alt="" />
      <div class="cx-hero-main">
        <h2>${esc(complex.aptNm)}</h2>
        <div class="meta">${esc(complex.region.fullName)} ${esc(complex.umdNm)} ${esc(complex.jibun)}</div>
        ${complex.buildYear ? `<span class="tag">${complex.buildYear}년 준공</span>` : ''}
      </div>
    </div>
    <div class="seg" role="tablist">${Object.entries(TYPES).map(([t, l]) => `<button role="tab" data-type="${t}">${l}${newTypes.has(t) ? '<i class="tab-dot" aria-label="새 거래"></i>' : ''}</button>`).join('')}</div>
    <button class="alert-btn" id="alertBtn"></button>
    <div id="body"><div class="spinner"></div></div>`;
  const $body = $view.querySelector('#body');
  const $btn = $view.querySelector('#alertBtn');

  const mySub = () => subs.find((s) => s.lawdCd === lawd && s.complexId === id && s.type === type);
  const drawBtn = () => {
    const s = mySub();
    $btn.className = `alert-btn ${s ? 'on' : ''}`;
    $btn.textContent = s ? `✓ ${TYPES[type]} 실거래 알림 받는 중 (해제하려면 탭)` : `🔔 ${TYPES[type]} 실거래 알림 받기`;
  };
  $btn.onclick = async () => {
    $btn.disabled = true;
    try {
      const s = mySub();
      if (s) {
        await api(`/api/subscriptions/${s.id}`, { method: 'DELETE' });
        subs.splice(subs.indexOf(s), 1);
        toast('알림을 해제했습니다');
      } else {
        const pushOk = await ensurePush().catch(() => false);
        const r = await api('/api/subscriptions', { method: 'POST', body: { lawdCd: lawd, complexId: id, type } });
        subs.push(r.subscription);
        toast(`최근 한 달 ${r.recentCount}건을 보냈어요. ${pushOk ? '새 거래도 푸시로 알려드릴게요' : '푸시가 꺼져 있어 앱 안 알림함으로 받아요'}`);
        refreshUnread();
      }
      drawBtn();
    } catch (e) {
      toast(e.message);
    } finally {
      $btn.disabled = false;
    }
  };

  let data;
  const draw = () => {
    const deals = data.deals.filter((d) => area === 'all' || String(Math.round(d.area)) === area);
    const areas = [...new Set(data.deals.map((d) => String(Math.round(d.area))))].sort((a, b) => a - b);
    const s = data.summary30;
    $body.innerHTML = `
      ${areas.length > 1 ? `<div class="chips" style="margin-bottom:12px">
        <button class="chip ${area === 'all' ? 'active' : ''}" data-area="all">전체 면적</button>
        ${areas.map((a) => `<button class="chip ${area === a ? 'active' : ''}" data-area="${a}">${a}㎡ (${pyeong(a)}평)</button>`).join('')}
      </div>` : ''}
      <div class="section-title">최근 1개월 ${TYPES[type]}</div>
      <div class="card">${s.count ? `<div class="stats num">
        <div><small>거래</small><b>${s.count}건</b></div>
        <div><small>평균${type === 'monthly' ? ' 보증금' : ''}</small><b>${won(s.avg)}</b></div>
        <div><small>최고</small><b>${won(s.max)}</b></div>
        <div><small>최저</small><b>${won(s.min)}</b></div>
      </div>` : '<div class="meta">최근 한 달간 신고된 거래가 없습니다</div>'}</div>
      <div class="section-title">최근 ${data.months}개월 추이</div>
      <div class="card">${chart(deals)}</div>
      <div class="section-title">실거래 내역 ${deals.length}건</div>
      <div class="card">${deals.length ? deals.map((d) => dealRow(d, newKeys.has(d.key))).join('') : '<div class="meta">거래 내역이 없습니다</div>'}</div>
      <p class="meta" style="margin:12px 4px">출처: 국토교통부 실거래가 공개시스템 · 계약 후 30일 이내 신고되므로 최근 거래는 계속 추가됩니다.${type === 'monthly' ? ' 월세는 보증금 / 월세(만원) 기준입니다.' : ''}</p>`;
    $body.querySelectorAll('[data-area]').forEach((b) => (b.onclick = () => { area = b.dataset.area; draw(); }));
    if (focusKey) {
      const el = [...$body.querySelectorAll('[data-key]')].find((x) => x.dataset.key === focusKey);
      focusKey = '';
      if (el) {
        el.classList.add('flash');
        setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      }
    }
  };
  const load = async () => {
    $view.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    drawBtn();
    $body.innerHTML = '<div class="spinner"></div>';
    try {
      data = await api(`/api/complexes/${lawd}/${id}/deals?type=${type}`);
      area = 'all';
      draw();
    } catch (e) {
      $body.innerHTML = errorHtml(e);
    }
  };
  $view.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => {
    type = b.dataset.type;
    history.replaceState(null, '', `#/complex/${lawd}/${id}?type=${type}`);
    load();
  }));
  load();
}

function dealRow(d, isNew = false) {
  const tags = [];
  if (isNew && !d.canceled) tags.push('<span class="new-dot">NEW</span>');
  if (d.canceled) tags.push('<span class="tag danger">해제</span>');
  if (d.dealingGbn === '직거래') tags.push('<span class="tag">직거래</span>');
  if (d.contractType) tags.push(`<span class="tag">${esc(d.contractType)}</span>`);
  return `<div class="deal ${d.canceled ? 'canceled' : ''} ${isNew ? 'is-new' : ''}" data-key="${esc(d.key)}">
    <div><b class="num">${d.date.slice(2).replace(/-/g, '.')}</b> ${tags.join(' ')}</div>
    <div class="price num" style="text-align:right">${d.type === 'monthly' ? `${won(d.deposit)}<small class="ir-rent" style="display:block">월 ${Number(d.monthlyRent).toLocaleString()}만</small>` : dealPrice(d)}</div>
    <div class="meta num">${m2(d.area)}㎡ (${pyeong(d.area)}평) · ${d.floor}층${d.dong ? ` · ${esc(d.dong)}동` : ''}</div>
    <div class="meta num" style="text-align:right">${Math.round((d.type === 'trade' ? d.price : d.deposit) / pyeong(d.area)).toLocaleString()}만/평</div>
  </div>`;
}

function chart(deals) {
  const pts = deals.filter((d) => !d.canceled).map((d) => ({ t: new Date(d.date).getTime(), v: d.type === 'trade' ? d.price : d.deposit }));
  if (pts.length < 2) return '<div class="meta">그래프를 그리기에 거래가 부족합니다</div>';
  const W = 600, H = 200, L = 64, R = 12, T = 10, B = 22;
  const t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t)) || t0 + 1;
  let v0 = Math.min(...pts.map((p) => p.v)), v1 = Math.max(...pts.map((p) => p.v));
  const pad = (v1 - v0) * 0.15 || v1 * 0.05; v0 -= pad; v1 += pad;
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  const ticks = [v0 + (v1 - v0) * 0.1, (v0 + v1) / 2, v1 - (v1 - v0) * 0.1];
  const fmtD = (t) => { const d = new Date(t); return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`; };
  const color = { trade: 'var(--trade)', jeonse: 'var(--jeonse)', monthly: 'var(--monthly)' }[deals[0].type];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="실거래가 추이">
    ${ticks.map((v) => `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 10000 ? `${(v / 10000).toFixed(1)}억` : `${Math.round(v).toLocaleString()}만`}</text>`).join('')}
    <text x="${L}" y="${H - 6}">${fmtD(t0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtD(t1)}</text>
    ${pts.map((p) => `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="7" fill="${color}" fill-opacity=".7"/>`).join('')}
  </svg>`;
}

// ---------- 화면: 내 알림 ----------
async function viewAlerts() {
  setHeader('내 알림');
  loading();
  const [subs, { notifications }] = await Promise.all([api('/api/subscriptions'), api('/api/notifications')]);
  if (isApp) config = await api('/api/config');
  const inbox = groupInbox(notifications, subs);
  await enrichInbox(inbox, subs);
  // 같은 단지의 매매·전세·월세 구독을 카드 하나로 묶음
  const groups = [];
  for (const s of subs) {
    let g = groups.find((x) => x.lawdCd === s.lawdCd && x.complexId === s.complexId);
    if (!g) groups.push((g = { lawdCd: s.lawdCd, complexId: s.complexId, aptNm: s.aptNm, umdNm: s.umdNm, region: s.region, subs: [] }));
    g.subs.push(s);
  }
  const perm = isApp ? config.notifyPermission : pushSupported() ? Notification.permission : 'unsupported';
  const pushCard = {
    granted: `<span class="ok-dot">${IC.check}</span><b>푸시 알림이 켜져 있어요</b><button class="pill-btn" id="testPush">테스트 ${IC.chev}</button>`,
    denied: isApp
      ? `<span class="ok-dot off">!</span><b>알림이 꺼져 있어요</b><button class="pill-btn primary" id="openNotiSettings">설정 열기 ${IC.chev}</button>`
      : '<b>🚫 브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 허용해 주세요.</b>',
    default: `<span class="ok-dot off">${IC.bell}</span><b>푸시 알림을 켜면 새 실거래를 바로 받아요</b><button class="pill-btn primary" id="enablePush">켜기 ${IC.chev}</button>`,
    unsupported: '<span class="meta">이 브라우저는 푸시를 지원하지 않아요. 알림은 아래 알림함에 쌓입니다.</span>',
  }[perm];
  const SUB_PREVIEW = 3;

  $view.innerHTML = `
    <div class="card push-card">${pushCard}</div>
    <div class="sec-row"><h3 class="sec">${IC.bell}알림 받는 단지 ${groups.length}곳</h3>${groups.length > SUB_PREVIEW ? `<button class="more-link" id="subMore">더보기 ${IC.chev}</button>` : ''}</div>
    <div class="list" id="subList">${groups.length ? groups.map((g, i) => `
      <div class="card sub-card ${i >= SUB_PREVIEW ? 'extra' : ''}">
        <a class="thumb-link" href="#/complex/${g.lawdCd}/${g.complexId}?type=${g.subs[0].type}"><img class="thumb" src="${THUMB}" alt="" /></a>
        <div class="sub-main">
          <div class="sub-top">
            <a href="#/complex/${g.lawdCd}/${g.complexId}?type=${g.subs[0].type}" style="flex:1;min-width:0">
              <h3>${esc(g.aptNm)}</h3>
              <div class="meta">${esc(g.region?.fullName || '')} ${esc(g.umdNm)}</div>
            </a>
            <button class="pill-btn small" data-unsub-all="${g.subs.map((s) => s.id).join(',')}">전체 해제</button>
          </div>
          <div class="sub-tags">${Object.keys(TYPES).map((t) => {
            const s = g.subs.find((x) => x.type === t);
            return s
              ? `<span class="tag-chip ${t}"><a href="#/complex/${g.lawdCd}/${g.complexId}?type=${t}">${IC.bell}${TYPES[t]}</a><button aria-label="${TYPES[t]} 알림 해제" data-unsub="${s.id}" data-label="${TYPES[t]}">✕</button></span>`
              : `<a class="tag-chip off" href="#/complex/${g.lawdCd}/${g.complexId}?type=${t}">＋ ${TYPES[t]}</a>`;
          }).join('')}</div>
        </div>
      </div>`).join('') : '<div class="card meta">아직 알림 받는 단지가 없어요. 단지를 찾아 🔔 버튼을 눌러보세요.</div>'}
    </div>
    ${config.demo && subs.length ? '<button class="btn" id="demoPoll" style="margin-top:12px;width:100%">🧪 데모: 새 실거래 발생시키기</button>' : ''}
    ${isApp && subs.length ? `<button class="cta" id="pollNow"><span class="cta-ic">${IC.refresh}</span><span class="cta-text">지금 새 실거래 확인</span><span class="cta-chev">${IC.chev}</span></button>
      <div class="last-check">${IC.clock}마지막 확인: ${config.lastPollAt ? ago(config.lastPollAt) : '아직 없음'} <span class="dot">•</span> ${intervalLabel(config.pollIntervalMinutes)}마다 자동 확인</div>` : ''}
    <h3 class="sec">${IC.star}알림함</h3>
    <div class="list">${inbox.length ? inbox.map(inboxCard).join('') : '<div class="card meta">받은 알림이 없습니다</div>'}
    </div>`;

  $view.querySelector('#enablePush')?.addEventListener('click', async () => {
    toast((await ensurePush().catch(() => false)) ? '푸시 알림을 켰어요' : '알림 권한을 얻지 못했어요');
    viewAlerts();
  });
  $view.querySelector('#openNotiSettings')?.addEventListener('click', () => api('/api/app/open-notification-settings', { method: 'POST' }));
  $view.querySelector('#testPush')?.addEventListener('click', async () => {
    await ensurePush().catch(() => false);
    const r = await api('/api/push/test', { method: 'POST' });
    toast(r.devices ? '테스트 알림을 보냈어요' : '등록된 기기가 없어요');
  });
  $view.querySelector('#demoPoll')?.addEventListener('click', async () => {
    const r = await api('/api/admin/poll?inject=1', { method: 'POST' });
    toast(`새 거래 알림 ${r.notificationsSent}건 발송`);
    viewAlerts();
  });
  $view.querySelector('#subMore')?.addEventListener('click', (ev) => {
    $view.querySelector('#subList').classList.add('expanded');
    ev.currentTarget.remove();
  });
  $view.querySelector('#pollNow')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.classList.add('spinning');
    btn.querySelector('.cta-text').textContent = '확인 중…';
    try {
      const r = await api('/api/admin/poll', { method: 'POST' });
      toast(r.errors?.length ? `오류: ${r.errors[0].error}` : r.notificationsSent ? `새 거래 알림 ${r.notificationsSent}건` : '새로 신고된 거래가 없어요');
    } catch (e) { toast(e.message); }
    viewAlerts();
  });
  $view.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => {
    b.closest('.inbox-card').classList.add('expanded');
    b.remove();
  }));
  $view.querySelectorAll('[data-unsub]').forEach((b) => (b.onclick = async () => {
    await api(`/api/subscriptions/${b.dataset.unsub}`, { method: 'DELETE' });
    toast(`${b.dataset.label} 알림을 해제했습니다`);
    viewAlerts();
  }));
  $view.querySelectorAll('[data-unsub-all]').forEach((b) => (b.onclick = async () => {
    if (!confirm('이 단지의 매매·전세·월세 알림을 모두 해제할까요?')) return;
    for (const id of b.dataset.unsubAll.split(',')) await api(`/api/subscriptions/${id}`, { method: 'DELETE' });
    toast('이 단지의 알림을 모두 해제했습니다');
    viewAlerts();
  }));
  if (notifications.some((n) => !n.read)) {
    await api('/api/notifications/read-all', { method: 'POST' });
    refreshUnread();
  }
}

// ---------- 알림함: 단지별로 묶고 매매·전세·월세 거래를 최신순으로 ----------
function groupInbox(notifications, subs) {
  const groups = new Map();
  for (const n of notifications) {
    const k = n.complexId ? `${n.lawdCd}:${n.complexId}` : `n:${n.id}`;
    if (!groups.has(k)) groups.set(k, { key: k, lawdCd: n.lawdCd, complexId: n.complexId, list: [] });
    groups.get(k).list.push(n);
  }
  return [...groups.values()].map((g) => {
    const sub = subs.find((s) => s.complexId === g.complexId && s.lawdCd === g.lawdCd);
    const first = g.list[0]; // 최신 알림 (서버가 최신순으로 줌)
    g.aptNm = first.aptNm || sub?.aptNm || first.title.replace(/^\S+\s/, '').replace(/\s(매매|전세|월세).*$|\s새 실거래.*$|\s거래 해제.*$/, '');
    g.place = sub ? `${sub.region?.fullName || ''} ${sub.umdNm}` : first.umdNm || '';
    g.latest = first.createdAt;
    g.unread = g.list.some((n) => !n.read);
    // 거래 합치기: 같은 거래는 한 번만, 해제 정보는 우선
    const rows = new Map();
    for (const n of [...g.list].reverse()) {
      for (const d of n.deals || []) {
        const prev = rows.get(d.key);
        rows.set(d.key, { ...d, canceled: d.canceled || prev?.canceled, isNew: Boolean(prev?.isNew || n.kind === 'new') });
      }
    }
    g.rows = [...rows.values()].sort((a, b) => (a.date === b.date ? b.floor - a.floor : a.date < b.date ? 1 : -1));
    // 거래 정보가 없는 예전 알림: '없습니다' 안내보다 실제 거래가 적힌 문구를 우선
    g.textOnly = g.rows.length ? null : (g.list.find((n) => !/없습니다/.test(n.body)) || first).body;
    g.title = first.title;
    return g;
  });
}

/** 알림 받는 단지는 최근 한 달 실거래를 직접 다시 불러와 매매·전세·월세를 합쳐 보여줌 */
async function enrichInbox(inbox, subs) {
  const d = new Date(Date.now() - 30 * 86400000);
  const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await Promise.all(inbox.map(async (g) => {
    const types = subs.filter((s) => s.lawdCd === g.lawdCd && s.complexId === g.complexId).map((s) => s.type);
    if (!g.complexId || !types.length) return;
    try {
      const lists = await Promise.all(types.map((t) => api(`/api/complexes/${g.lawdCd}/${g.complexId}/deals?type=${t}&months=2`)));
      const newKeys = new Set(g.rows.filter((r) => r.isNew).map((r) => r.key));
      const rows = new Map();
      for (const x of lists.flatMap((r) => r.deals)) if (x.date >= since) rows.set(x.key, { ...x, isNew: newKeys.has(x.key) });
      for (const r of g.rows) if (r.isNew && !rows.has(r.key)) rows.set(r.key, r); // 알림 받은 새 거래는 유지
      g.rows = [...rows.values()].sort((a, b) => (a.date === b.date ? b.floor - a.floor : a.date < b.date ? 1 : -1));
      g.recent = true;
      g.textOnly = g.rows.length ? null : '최근 한 달간 신고된 실거래가 없습니다. 새 거래가 신고되면 알려드릴게요.';
    } catch { /* 불러오기 실패 시 알림에 저장된 내용으로 표시 */ }
  }));
}

const INBOX_PREVIEW = 6;
function inboxCard(g) {
  const counts = Object.entries(TYPES).map(([t, l]) => [t, l, g.rows.filter((r) => r.type === t).length]).filter((x) => x[2]);
  const href = g.complexId ? `#/complex/${g.lawdCd}/${g.complexId}?type=${g.rows[0]?.type || 'trade'}` : '#/alerts';
  const row = (d) => `
    <a class="inbox-row ${d.canceled ? 'canceled' : ''}" href="#/complex/${g.lawdCd}/${g.complexId}?type=${d.type}&focus=${encodeURIComponent(d.key)}">
      <span class="ir-mid"><b class="num"><span class="tag ${d.type}">${TYPES[d.type]}</span> ${d.date.slice(2).replace(/-/g, '.')}${d.canceled ? ' <span class="tag danger">해제</span>' : d.isNew ? ' <span class="new-dot">NEW</span>' : ''}</b><small class="meta num">${m2(d.area)}㎡ · ${d.floor}층</small></span>
      <span class="ir-right"><span class="price num ir-price">${d.type === 'monthly' ? won(d.deposit) : dealPrice(d)}</span>${d.type === 'monthly' ? `<small class="ir-rent num">월 ${Number(d.monthlyRent).toLocaleString()}만</small>` : ''}</span>
    </a>`;
  return `
    <div class="card inbox-card ${g.unread ? 'unread' : ''}">
      <a class="inbox-head" href="${href}">
        <img class="thumb sm" src="${THUMB}" alt="" />
        <span class="ih-main">
          <span class="card-row"><h3>${esc(g.aptNm)}</h3><span class="meta ih-time">${ago(g.latest)} ${IC.chev}</span></span>
          ${g.place.trim() ? `<span class="meta">${esc(g.place)}</span>` : ''}
        </span>
      </a>
      ${counts.length ? `<div class="counts">${counts.map(([t, l, c]) => `<span class="tag ${t}">${l} ${c}</span>`).join('')}<span class="meta" style="margin-left:auto">${g.recent ? '최근 1개월 · ' : ''}최신순</span></div>` : ''}
      ${g.rows.length ? `<div class="inbox-rows">${g.rows.map((d, i) => (i < INBOX_PREVIEW ? row(d) : row(d).replace('class="inbox-row', 'class="inbox-row extra'))).join('')}</div>
        ${g.rows.length > INBOX_PREVIEW ? `<button class="btn small block" data-more style="margin-top:8px">더 보기 (${g.rows.length - INBOX_PREVIEW}건)</button>` : ''}`
        : `<div class="meta notif-body" style="margin-top:6px">${esc(g.textOnly || '')}</div>`}
    </div>`;
}

// ---------- 화면: 설정 (앱 전용) ----------
const INTERVALS = [30, 60, 180, 360, 720, 1440];
function intervalLabel(m) {
  if (!m) return '';
  return m < 60 ? `${m}분` : m % 1440 === 0 ? `${m / 1440}일` : `${m / 60}시간`;
}

async function viewSettings() {
  setHeader('설정');
  loading();
  const st = await api('/api/settings');
  config = await api('/api/config');
  const P = { ...DEFAULT_PREFS, ...(st.prefs || prefs) };
  const prefSwitch = (k, title, desc) => `
    <div class="pref-row"><span class="pref-text">${title}<small>${desc}</small></span>
      <label class="switch"><input type="checkbox" data-switch="${k}" ${P[k] ? 'checked' : ''} aria-label="${title}" /><span></span></label></div>`;
  const prefSeg = (k, opts) => `<div class="seg pref-seg" data-seg="${k}">${opts.map(([v, l]) => `<button data-val="${v}" class="${String(P[k]) === String(v) ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  const permText = { granted: '<span class="ok">✅ 켜짐</span>', denied: '🚫 꺼짐', default: '아직 허용 안 함' }[config.notifyPermission] || '-';
  $view.innerHTML = `
    <div id="dataSection" ${config.relayOnly ? 'hidden' : ''}>
    <div class="section-title">데이터 연결</div>
    <div class="card stack">
      <div id="srcStatus">${{
        proxy: '<span class="ok">✅ 중계 서버 사용 중</span> <span class="meta">— API 키 입력 없이 바로 쓸 수 있어요</span>',
        key: '<span class="ok">✅ 개인 API 키 사용 중</span>',
        none: '❗ 연결 설정이 필요해요. 중계 서버 주소를 넣거나 개인 API 키를 입력하세요.',
      }[st.dataSource]}</div>
      <label class="field"><span>중계 서버 주소</span>
        <input id="proxyInput" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://apt-alert.○○○.workers.dev" value="${esc(st.proxyUrl)}" /></label>
      <button class="btn primary block" id="saveProxy">중계 서버 저장하고 테스트</button>
      <div id="proxyResult" class="meta"></div>
    </div>

    <details class="card" ${st.serviceKeySet || st.dataSource === 'none' ? 'open' : ''}>
      <summary><b>개인 API 키 (선택)</b> <span class="meta">— 중계 서버 대신 내 키로 직접 조회</span></summary>
      <div class="stack" style="margin-top:12px">
        <div class="meta" id="keyStatus">${st.serviceKeySet ? `<span class="ok">✅ 저장됨</span> (${esc(st.serviceKeyMasked)}) · 개인 키가 있으면 개인 키를 우선 사용해요` : '입력하지 않으면 중계 서버를 사용해요.'}</div>
        <label class="field"><span>일반 인증키 (Encoding 또는 Decoding 아무거나)</span>
          <input id="keyInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="발급받은 인증키 붙여넣기" /></label>
        <div class="btn-row">
          <button class="btn primary" id="saveKey">키 저장하고 테스트</button>
          ${st.serviceKeySet ? '<button class="btn" id="removeKey">키 삭제</button>' : ''}
        </div>
        <div id="keyResult" class="meta"></div>
      </div>
    </details>

    </div>
    <div class="section-title">알림</div>
    <div class="card stack">
      <div class="card-row"><span>알림 권한</span><span>${permText}</span></div>
      <div class="btn-row">
        <button class="btn" id="askPerm">알림 허용</button>
        <button class="btn" id="notiSettings">휴대폰 설정</button>
        <button class="btn" id="testNoti">테스트 알림</button>
      </div>
      <label class="field"><span>새 실거래 자동 확인 주기</span>
        <select id="interval">${INTERVALS.map((m) => `<option value="${m}" ${m === st.pollIntervalMinutes ? 'selected' : ''}>${intervalLabel(m)}마다</option>`).join('')}</select></label>
      <div class="pref-note">국토부 데이터는 보통 하루 한 번 갱신돼요. 3시간이면 충분해요.</div>
      <button class="btn block" id="battery">🔋 배터리 최적화 해제 (알림이 늦게 올 때)</button>
    </div>

    <div class="section-title">알림 방법</div>
    <div class="card stack">
      ${prefSwitch('notiSound', '🔊 소리', '알림이 올 때 소리 내기')}
      <div class="pref-row pref-sub" data-dep="notiSound"><span>알림음</span><button class="btn small" id="pickSound">${esc(P.soundName)} ›</button></div>
      ${prefSwitch('notiVibrate', '📳 진동', '알림이 올 때 진동')}
      <div class="pref-sub" data-dep="notiVibrate"><span class="label">진동 패턴</span>${prefSeg('vibratePattern', [['short', '짧게'], ['long', '길게'], ['double', '두 번'], ['triple', '세 번']])}</div>
      ${prefSwitch('notiPopup', '💬 화면 위 팝업', '다른 앱을 쓰는 중에도 화면 위에 잠깐 표시')}
      ${prefSwitch('notiCanceled', '⚠️ 거래 해제 알림', '신고됐던 거래가 취소(해제)되면 알림')}
      ${prefSwitch('quietEnabled', '🌙 조용한 시간', '이 시간엔 소리·진동 없이 조용히 알림')}
      <div class="time-row pref-sub" data-dep="quietEnabled">
        <input type="time" data-time="quietStart" value="${esc(P.quietStart)}" aria-label="시작 시각" /> ~
        <input type="time" data-time="quietEnd" value="${esc(P.quietEnd)}" aria-label="끝 시각" />
      </div>
      <div class="pref-note">소리·진동·팝업 설정은 다음에 오는 알림부터 적용돼요. <b>테스트 알림</b>으로 확인해 보세요.</div>
    </div>

    <div class="section-title">알림 디자인</div>
    <div class="card stack">
      <div><span class="label">알림 색상</span>
        <div class="swatches five">
          <button class="swatch ${P.notiColor === 'app' ? 'active' : ''}" data-noticolor="app"><i style="background:conic-gradient(#2563eb,#059669,#db2777,#ea580c,#2563eb)"></i>앱 색상</button>
          ${Object.entries(ACCENTS).map(([k, [l, , name]]) => `<button class="swatch ${P.notiColor === k ? 'active' : ''}" data-noticolor="${k}"><i style="background:${l}"></i>${name}</button>`).join('')}
        </div>
      </div>
      <div><span class="label">알림 아이콘 (상단바에 표시)</span>
        <div class="swatches">${Object.entries(NOTI_ICONS).map(([k, [name]]) => `<button class="swatch ${P.notiIcon === k ? 'active' : ''}" data-notiicon="${k}"><i class="icon-dot">${iconSvg(k, 16)}</i>${name}</button>`).join('')}</div>
      </div>
      <div><span class="label">제목 형식</span>${prefSeg('notiTitle', [['count', '건수 중심'], ['price', '가격 중심']])}</div>
      <div><span class="label">내용 표시</span>${prefSeg('notiDetail', [['simple', '간단히 (한 줄)'], ['detail', '자세히 (목록)']])}</div>
      <div><span class="label">잠금화면</span>${prefSeg('notiLockscreen', [['show', '내용 보이기'], ['hide', '내용 숨기기']])}</div>
    </div>

    <div class="section-title">알림 미리보기 <span class="meta" style="font-weight:400">· 설정을 바꾸면 바로 바뀌어요</span></div>
    <div id="preview"></div>

    <div class="section-title">화면 디자인</div>
    <div class="card stack">
      <div><span class="label">테마</span>${prefSeg('theme', [['system', '휴대폰 설정'], ['light', '☀️ 밝게'], ['dark', '🌙 어둡게']])}</div>
      <div><span class="label">강조 색상</span>
        <div class="swatches">${Object.entries(ACCENTS).map(([k, [l, , name]]) => `<button class="swatch ${P.accent === k ? 'active' : ''}" data-accent="${k}"><i style="background:${l}"></i>${name}</button>`).join('')}</div>
      </div>
      <div><span class="label">글자 크기</span>${prefSeg('fontScale', [[85, '작게'], [100, '보통'], [115, '크게'], [130, '아주 크게']])}</div>
    </div>


    <details class="card" style="margin-top:20px" ${config.relayOnly ? 'hidden' : ''}>
      <summary><b>개인 API 키 발급 방법</b> <span class="meta">(휴대폰으로 가능)</span></summary>
      <div style="margin-top:12px">
      <ol class="guide">
        <li><a class="link" href="https://www.data.go.kr" target="_blank" rel="noopener">공공데이터포털(data.go.kr)</a>에 회원가입 후 로그인</li>
        <li>검색창에 <b>아파트 매매 실거래가</b> 검색 → <b>「국토교통부_아파트 매매 실거래가 자료」</b> → <b>활용신청</b> (활용목적: 개인 참고용, 자동 승인)</li>
        <li>같은 방법으로 <b>「국토교통부_아파트 전월세 실거래가 자료」</b>도 <b>활용신청</b> (전세·월세용, 꼭 둘 다!)</li>
        <li>마이페이지 → <b>개발계정</b> → 신청한 API 클릭 → <b>일반 인증키</b>를 길게 눌러 복사</li>
        <li>위 입력칸에 붙여넣고 <b>저장하고 연결 테스트</b> → ✅ 나오면 끝!</li>
      </ol>
      <p class="meta" style="margin:8px 0 0">승인 직후에는 키가 활성화되기까지 1~2시간 걸릴 수 있어요. 테스트가 실패하면 잠시 후 다시 해보세요.</p>
      </div>
    </details>
    <p class="meta" style="margin:16px 4px">앱 버전 ${esc(config.appVersion || '')} · 데이터 출처: 국토교통부 실거래가 공개시스템</p>`;

  const okMsg = (r) => `<span class="ok">✅ 연결 성공!</span> 매매 ${r.trade}건 · 전월세 ${r.rent}건 확인 (서울 강남구 지난달)`;
  const failMsg = (e) => `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`;
  const runTest = async (btn, $out, body, save) => {
    btn.disabled = true;
    $out.textContent = '연결 테스트 중…';
    try {
      const r = await api('/api/settings/test', { method: 'POST', body });
      await api('/api/settings', { method: 'POST', body: save });
      $out.innerHTML = okMsg(r);
      toast('저장되었어요');
      config.hasKey = true;
      setTimeout(viewSettings, 1500);
    } catch (e) {
      $out.innerHTML = failMsg(e);
    } finally {
      btn.disabled = false;
    }
  };
  $view.querySelector('#saveProxy').onclick = (ev) => {
    const url = $view.querySelector('#proxyInput').value.trim();
    if (!url) return toast('중계 서버 주소를 입력해 주세요');
    runTest(ev.target, $view.querySelector('#proxyResult'), { proxyUrl: url }, { proxyUrl: url });
  };
  $view.querySelector('#saveKey').onclick = (ev) => {
    const key = $view.querySelector('#keyInput').value.trim();
    if (!key) return toast('인증키를 붙여넣어 주세요');
    runTest(ev.target, $view.querySelector('#keyResult'), { serviceKey: key }, { serviceKey: key });
  };
  $view.querySelector('#removeKey')?.addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: { serviceKey: '' } });
    toast('개인 키를 삭제했어요. 중계 서버를 사용합니다');
    viewSettings();
  });
  // ----- 미리보기 -----
  const PATTERN_LABEL = { short: '짧게', long: '길게', double: '두 번', triple: '세 번' };
  const PATTERN_MS = { short: [200], long: [700], double: [200, 150, 200], triple: [150, 100, 150, 100, 150] };
  const $pv = $view.querySelector('#preview');
  const renderPreview = () => {
    const now = new Date();
    const hhmm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    const color = (ACCENTS[P.notiColor === 'app' ? P.accent : P.notiColor] || ACCENTS.blue)[0];
    const title = P.notiTitle === 'price'
      ? '🏠 예시 래미안아파트 매매 32억 (84.94㎡·29층) 외 1건'
      : '🏠 예시 래미안아파트 새 실거래 2건 (매매 1 · 전세 1)';
    const lines = ['[매매] 84.94㎡ 29층 · 32억 · 11/10', '[전세] 59.98㎡ 12층 · 13억 5,000만 · 11/08'];
    const head = (extra = '') => `<div class="pv-head"><span class="pv-icon" style="background:${color}">${iconSvg(P.notiIcon)}</span>
      <span style="color:${color};font-weight:700">실거래 알리미</span><span class="meta">· 지금</span>${extra}</div>`;
    const noti = (cls = '', expanded = P.notiDetail === 'detail') => `<div class="pv-noti ${cls}">
      ${head(expanded ? '<span class="pv-expand">⌃</span>' : '<span class="pv-expand">⌄</span>')}
      <b class="pv-title ${expanded ? '' : 'one'}">${title}</b>
      <div class="pv-body num ${expanded ? '' : 'one'}">${expanded ? lines.join('<br>') : lines[0]}</div>
    </div>`;
    const statusbar = `<div class="pv-statusbar dark"><span>${hhmm} <span class="pv-sbicon">${iconSvg(P.notiIcon, 13)}</span></span><span>📶 🔋</span></div>`;
    const flags = [
      P.notiSound ? `🔊 ${esc(P.soundName)}` : '🔇 소리 없음',
      P.notiVibrate ? `📳 진동 ${PATTERN_LABEL[P.vibratePattern] || ''}` : '📴 진동 없음',
      P.notiPopup ? '💬 화면 위 팝업' : '🔕 팝업 없음',
    ];
    $pv.innerHTML = `
      <div class="card stack">
        <span class="label">① 상단바를 내렸을 때 (알림창)</span>
        <div class="pv-phone">${statusbar}<div class="pv-shade"><div class="pv-qs">${'<i></i>'.repeat(5)}</div>${noti('flat')}</div></div>

        <span class="label">② 잠금화면</span>
        <div class="pv-phone"><div class="pv-lock"><div class="pv-clock">${hhmm}</div>
          ${P.notiLockscreen === 'hide'
            ? `<div class="pv-noti flat">${head()}<b class="pv-title one">실거래 알리미</b><div class="pv-body one">새 실거래 알림이 있어요</div></div>`
            : noti('flat', false)}
        </div></div>

        <div class="pv-flags">${flags.map((f) => `<span>${f}</span>`).join('')}</div>
        ${P.quietEnabled ? `<div class="pref-note">🌙 ${esc(P.quietStart)} ~ ${esc(P.quietEnd)}에는 소리·진동 없이 조용히 와요</div>` : ''}
        <div class="btn-row">
          <button class="btn" id="pvSound" ${P.notiSound ? '' : 'disabled'}>▶ 알림음 듣기</button>
          <button class="btn" id="pvVib" ${P.notiVibrate ? '' : 'disabled'}>📳 진동 느껴보기</button>
          <button class="btn primary" id="pvTest">실제로 보내보기</button>
        </div>
      </div>`;
    $pv.querySelector('#pvSound').onclick = () => api('/api/app/preview-sound', { method: 'POST' }).catch(() => toast('이 기기에서는 미리듣기를 할 수 없어요'));
    $pv.querySelector('#pvVib').onclick = () => {
      const ms = PATTERN_MS[P.vibratePattern] || [200];
      if (!(navigator.vibrate && navigator.vibrate(ms))) toast('이 기기에서는 진동 미리보기를 할 수 없어요');
    };
    $pv.querySelector('#pvTest').onclick = async () => {
      const r = await api('/api/push/test', { method: 'POST' }).catch((e) => ({ error: e.message }));
      toast(r.devices ? '테스트 알림을 보냈어요. 상단바를 확인해 보세요' : r.error || '알림 권한이 없어요');
    };
  };
  renderPreview();

  // ----- 알림 방법 · 화면 디자인 저장 -----
  const DESIGN = ['theme', 'accent', 'fontScale'];
  const syncDeps = () => $view.querySelectorAll('[data-dep]').forEach((el) => el.classList.toggle('disabled', !P[el.dataset.dep]));
  const savePref = async (k, v) => {
    P[k] = v;
    if (DESIGN.includes(k)) applyAppearance({ ...prefs, [k]: v });
    syncDeps();
    renderPreview();
    try {
      const r = await api('/api/settings', { method: 'POST', body: { prefs: { [k]: v } } });
      if (r.prefs) applyAppearance({ ...prefs, ...r.prefs });
    } catch (e) { toast(e.message); }
  };
  syncDeps();
  $view.querySelectorAll('[data-switch]').forEach((el) => (el.onchange = () => savePref(el.dataset.switch, el.checked)));
  $view.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    const k = seg.dataset.seg;
    savePref(k, k === 'fontScale' ? Number(b.dataset.val) : b.dataset.val);
  })));
  $view.querySelectorAll('[data-accent]').forEach((b) => (b.onclick = () => {
    $view.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('active', x === b));
    savePref('accent', b.dataset.accent);
  }));
  $view.querySelectorAll('[data-noticolor]').forEach((b) => (b.onclick = () => {
    $view.querySelectorAll('[data-noticolor]').forEach((x) => x.classList.toggle('active', x === b));
    savePref('notiColor', b.dataset.noticolor);
  }));
  $view.querySelectorAll('[data-notiicon]').forEach((b) => (b.onclick = () => {
    $view.querySelectorAll('[data-notiicon]').forEach((x) => x.classList.toggle('active', x === b));
    savePref('notiIcon', b.dataset.notiicon);
  }));
  $view.querySelectorAll('[data-time]').forEach((el) => (el.onchange = () => el.value && savePref(el.dataset.time, el.value)));
  $view.querySelector('#pickSound').onclick = async () => {
    try {
      const r = await api('/api/app/pick-sound', { method: 'POST' });
      if (r.prefs) { Object.assign(P, r.prefs); $view.querySelector('#pickSound').textContent = `${r.prefs.soundName} ›`; renderPreview(); }
    } catch (e) { toast(e.message); }
  };
  $view.querySelector('#interval').onchange = async (ev) => {
    await api('/api/settings', { method: 'POST', body: { pollIntervalMinutes: Number(ev.target.value) } });
    toast(`${intervalLabel(Number(ev.target.value))}마다 확인할게요`);
  };
  $view.querySelector('#askPerm').onclick = async () => { toast((await ensurePush()) ? '알림이 허용되었어요' : '알림이 허용되지 않았어요'); viewSettings(); };
  $view.querySelector('#notiSettings').onclick = () => api('/api/app/open-notification-settings', { method: 'POST' });
  $view.querySelector('#battery').onclick = () => api('/api/app/open-battery-settings', { method: 'POST' });
  $view.querySelector('#testNoti').onclick = async () => {
    const r = await api('/api/push/test', { method: 'POST' });
    toast(r.devices ? '테스트 알림을 보냈어요' : '알림 권한이 없어요');
  };
}

// ---------- 라우터 ----------
async function route() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  // 홈·내 알림 화면은 상단 일러스트 배너, 나머지는 기존 상단 바
  const heroMode = !parts[0] ? 'home' : parts[0] === 'alerts' ? 'plain' : '';
  document.body.classList.toggle('has-hero', Boolean(heroMode));
  document.body.dataset.page = parts[0] || 'home';
  document.getElementById('hero').hidden = !heroMode;
  document.getElementById('heroBrand').hidden = true; // 홈 배너 그림에 제목이 들어 있음
  const tab = ['alerts', 'settings'].includes(parts[0]) ? parts[0] : 'search';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'region' && parts[1]) await viewRegion(parts[1]);
    else if (parts[0] === 'complex' && parts[2]) await viewComplex(parts[1], parts[2], params);
    else if (parts[0] === 'alerts') await viewAlerts();
    else if (parts[0] === 'settings' && isApp) await viewSettings();
    else await viewHome();
  } catch (e) {
    showError(e);
  }
}

(async function init() {
  if (!isApp && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  document.getElementById('settingsTab').hidden = !isApp;
  window.__navigate = (hash) => { location.hash = hash; };
  try {
    config = await api('/api/config');
    document.getElementById('demoBadge').hidden = !config.demo;
    if (config.prefs) applyAppearance({ ...prefs, ...config.prefs });
  } catch (e) {
    config = { demo: false };
  }
  window.addEventListener('hashchange', route);
  route();
  refreshUnread();
  setInterval(refreshUnread, 60_000);
})();
