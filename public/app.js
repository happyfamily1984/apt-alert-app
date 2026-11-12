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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function won(v) {
  const n = Math.round(Number(v) || 0);
  const eok = Math.floor(n / 10000), rest = n % 10000;
  if (eok && rest) return `${eok}억 ${rest.toLocaleString()}`;
  if (eok) return `${eok}억`;
  return `${rest.toLocaleString()}만`;
}
const pyeong = (m2) => (m2 / 3.3058).toFixed(1);
const dealPrice = (d) => (d.type === 'trade' ? won(d.price) : d.type === 'jeonse' ? won(d.deposit) : `${won(d.deposit)} / ${d.monthlyRent}`);
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
const errorHtml = (e) => `<div class="error">⚠️ ${esc(e.message)}${isApp && /키|연결|중계/.test(e.message) ? '<br><br><a class="btn primary" href="#/settings">⚙️ 연결 설정하러 가기</a>' : ''}</div>`;
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
    $view.innerHTML = `
      ${isApp && !config.hasKey ? '<a class="banner" href="#/settings">👉 먼저 ⚙️ 설정에서 데이터 연결(중계 서버 주소 또는 API 키)을 설정해 주세요</a>' : ''}
      ${recent.length ? `<div class="section-title">최근 본 지역</div>
        <div class="chips">${recent.map((x) => `<a class="chip" href="#/region/${x.code}">${esc(x.name)}</a>`).join('')}</div>` : ''}
      <div class="section-title">시·도</div>
      <div class="chips" id="sidoChips">${regionsCache.map((x) => `<button class="chip ${x.sido === r.sido ? 'active' : ''}" data-sido="${esc(x.sido)}">${esc(x.sido)}</button>`).join('')}</div>
      <div class="section-title">시·군·구</div>
      <div class="grid">${r.sigungu.map((s) => `<a href="#/region/${s.code}">${esc(s.name)}</a>`).join('')}</div>`;
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

  const q = sessionStorage.getItem(`q:${lawd}`) || '';
  $view.innerHTML = `
    <input class="search" type="search" placeholder="단지명 또는 동 이름 검색" value="${esc(q)}" aria-label="단지 검색" />
    <div class="meta" id="count" style="margin:0 4px 8px"></div>
    <div class="list" id="list"></div>`;
  const $list = $view.querySelector('#list');
  const $input = $view.querySelector('.search');
  const draw = () => {
    const term = $input.value.trim().replace(/\s+/g, '');
    try { sessionStorage.setItem(`q:${lawd}`, $input.value); } catch { /* */ }
    const items = complexes.filter((c) => !term || `${c.aptNm}${c.umdNm}`.replace(/\s+/g, '').includes(term));
    $view.querySelector('#count').textContent = `최근 거래가 있는 단지 ${items.length}곳`;
    $list.innerHTML = items.length
      ? items.map((c) => `
        <a class="card" href="#/complex/${lawd}/${c.id}">
          <div class="card-row"><h3>${esc(c.aptNm)}</h3>${c.lastTradePrice ? `<span class="price num">${won(c.lastTradePrice)}</span>` : ''}</div>
          <div class="card-row meta"><span>${esc(c.umdNm)} ${esc(c.jibun)}${c.buildYear ? ` · ${c.buildYear}년` : ''}</span>${c.lastTradeDate ? `<span>${c.lastTradeDate.slice(2).replace(/-/g, '.')} 매매</span>` : ''}</div>
          <div class="counts">${Object.entries(TYPES).map(([t, l]) => `<span class="tag ${t}">${l} ${c.counts[t]}</span>`).join('')}</div>
        </a>`).join('')
      : '<div class="empty">검색 결과가 없습니다</div>';
  };
  $input.oninput = draw;
  draw();
}

// ---------- 화면: 단지 상세 ----------
async function viewComplex(lawd, id, params) {
  setHeader('단지 정보', `#/region/${lawd}`);
  loading();
  const [complex, subs] = await Promise.all([api(`/api/complexes/${lawd}/${id}`), api('/api/subscriptions')]);
  setHeader(complex.aptNm, `#/region/${lawd}`);
  let type = TYPES[params.get('type')] ? params.get('type') : 'trade';
  let area = 'all';

  $view.innerHTML = `
    <div class="hero">
      <h2>${esc(complex.aptNm)}</h2>
      <div class="meta">${esc(complex.region.fullName)} ${esc(complex.umdNm)} ${esc(complex.jibun)}${complex.buildYear ? ` · ${complex.buildYear}년 준공` : ''}</div>
    </div>
    <div class="seg" role="tablist">${Object.entries(TYPES).map(([t, l]) => `<button role="tab" data-type="${t}">${l}</button>`).join('')}</div>
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
      <div class="card">${deals.length ? deals.map(dealRow).join('') : '<div class="meta">거래 내역이 없습니다</div>'}</div>
      <p class="meta" style="margin:12px 4px">출처: 국토교통부 실거래가 공개시스템 · 계약 후 30일 이내 신고되므로 최근 거래는 계속 추가됩니다.${type === 'monthly' ? ' 월세는 보증금 / 월세(만원) 기준입니다.' : ''}</p>`;
    $body.querySelectorAll('[data-area]').forEach((b) => (b.onclick = () => { area = b.dataset.area; draw(); }));
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

function dealRow(d) {
  const tags = [];
  if (d.canceled) tags.push('<span class="tag danger">해제</span>');
  if (d.dealingGbn === '직거래') tags.push('<span class="tag">직거래</span>');
  if (d.contractType) tags.push(`<span class="tag">${esc(d.contractType)}</span>`);
  return `<div class="deal ${d.canceled ? 'canceled' : ''}">
    <div><b class="num">${d.date.slice(2).replace(/-/g, '.')}</b> ${tags.join(' ')}</div>
    <div class="price num" style="text-align:right">${dealPrice(d)}</div>
    <div class="meta num">${d.area}㎡ (${pyeong(d.area)}평) · ${d.floor}층${d.dong ? ` · ${esc(d.dong)}동` : ''}</div>
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
  const perm = isApp ? config.notifyPermission : pushSupported() ? Notification.permission : 'unsupported';
  const pushCard = {
    granted: '<div class="card-row"><span>✅ 푸시 알림이 켜져 있어요</span><button class="btn small" id="testPush">테스트</button></div>',
    denied: isApp
      ? '<div class="card-row"><span>🚫 알림이 꺼져 있어요</span><button class="btn primary small" id="openNotiSettings">설정 열기</button></div>'
      : '<div>🚫 브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 알림을 허용해 주세요.</div>',
    default: '<div class="card-row"><span>푸시 알림을 켜면 새 실거래를 바로 받아요</span><button class="btn primary small" id="enablePush">켜기</button></div>',
    unsupported: '<div class="meta">이 브라우저는 푸시를 지원하지 않아요. (iPhone은 공유 → 홈 화면에 추가 후 사용) 알림은 아래 알림함에 쌓입니다.</div>',
  }[perm];

  $view.innerHTML = `
    <div class="card">${pushCard}</div>
    <div class="section-title">알림 받는 단지 ${subs.length}곳</div>
    <div class="list">${subs.length ? subs.map((s) => `
      <div class="card card-row">
        <a href="#/complex/${s.lawdCd}/${s.complexId}?type=${s.type}" style="flex:1;min-width:0">
          <h3>${esc(s.aptNm)} <span class="tag ${s.type}">${TYPES[s.type]}</span></h3>
          <div class="meta">${esc(s.region?.fullName || '')} ${esc(s.umdNm)}</div>
        </a>
        <button class="btn small" data-unsub="${s.id}">해제</button>
      </div>`).join('') : '<div class="card meta">아직 알림 받는 단지가 없어요. 단지를 찾아 🔔 버튼을 눌러보세요.</div>'}
    </div>
    ${config.demo && subs.length ? '<button class="btn" id="demoPoll" style="margin-top:12px;width:100%">🧪 데모: 새 실거래 발생시키기</button>' : ''}
    ${isApp && subs.length ? `<button class="btn" id="pollNow" style="margin-top:12px;width:100%">🔄 지금 새 실거래 확인</button>
      <div class="meta" style="margin:6px 4px 0">마지막 확인: ${config.lastPollAt ? ago(config.lastPollAt) : '아직 없음'} · ${intervalLabel(config.pollIntervalMinutes)}마다 자동 확인</div>` : ''}
    <div class="section-title">알림함</div>
    <div class="list">${notifications.length ? notifications.map((n) => `
      <a class="card notif ${n.read ? '' : 'unread'}" href="${n.complexId ? `#/complex/${n.lawdCd}/${n.complexId}?type=${n.type}` : '#/alerts'}">
        <div class="card-row"><b>${esc(n.title)}</b><span class="meta" style="white-space:nowrap">${ago(n.createdAt)}</span></div>
        <div class="meta num notif-body">${esc(n.body)}</div>
      </a>`).join('') : '<div class="card meta">받은 알림이 없습니다</div>'}
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
  $view.querySelector('#pollNow')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = '확인 중…';
    try {
      const r = await api('/api/admin/poll', { method: 'POST' });
      toast(r.errors?.length ? `오류: ${r.errors[0].error}` : r.notificationsSent ? `새 거래 알림 ${r.notificationsSent}건` : '새로 신고된 거래가 없어요');
    } catch (e) { toast(e.message); }
    viewAlerts();
  });
  $view.querySelectorAll('[data-unsub]').forEach((b) => (b.onclick = async () => {
    await api(`/api/subscriptions/${b.dataset.unsub}`, { method: 'DELETE' });
    toast('알림을 해제했습니다');
    viewAlerts();
  }));
  if (notifications.some((n) => !n.read)) {
    await api('/api/notifications/read-all', { method: 'POST' });
    refreshUnread();
  }
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
  const permText = { granted: '<span class="ok">✅ 켜짐</span>', denied: '🚫 꺼짐', default: '아직 허용 안 함' }[config.notifyPermission] || '-';
  $view.innerHTML = `
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

    <div class="section-title">알림</div>
    <div class="card stack">
      <div class="card-row"><span>알림 권한</span><span>${permText}</span></div>
      <div class="btn-row">
        <button class="btn" id="askPerm">알림 허용</button>
        <button class="btn" id="notiSettings">알림 설정</button>
        <button class="btn" id="testNoti">테스트 알림</button>
      </div>
      <label class="field"><span>새 실거래 자동 확인 주기</span>
        <select id="interval">${INTERVALS.map((m) => `<option value="${m}" ${m === st.pollIntervalMinutes ? 'selected' : ''}>${intervalLabel(m)}마다</option>`).join('')}</select></label>
      <div class="meta">국토부 데이터는 보통 하루 한 번 갱신돼요. 3시간이면 충분하고, 짧을수록 배터리·API 호출이 늘어요.</div>
      <button class="btn block" id="battery">🔋 배터리 최적화 해제 (알림이 늦게 올 때)</button>
    </div>

    <details class="card" style="margin-top:20px">
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
  } catch (e) {
    config = { demo: false };
  }
  window.addEventListener('hashchange', route);
  route();
  refreshUnread();
  setInterval(refreshUnread, 60_000);
})();
