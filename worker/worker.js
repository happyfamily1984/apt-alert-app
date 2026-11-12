// 실거래 알리미 중계 서버 (Cloudflare Worker)
// - 국토교통부 API 키는 서버(Secret: MOLIT_KEY)에만 보관 → 앱 사용자는 키 없이 사용
// - 결과를 캐시해서 사용자가 늘어도 국토부 호출 수는 "지역 수"만큼만 증가
//   (메모리 → Cache API(사용자 도메인일 때) → KV(CACHE 바인딩이 있을 때) 순서로 확인)
//
// 대시보드 설정
//   필수  Secret  MOLIT_KEY  : 공공데이터포털 일반 인증키
//   선택  Secret  APP_TOKEN  : 설정하면 앱이 X-App-Token 헤더로 같은 값을 보내야 함
//   선택  KV 바인딩 CACHE     : 캐시를 오래·여러 서버 간 공유 (권장)
//
// 요청 형식: GET /molit/trade?LAWD_CD=11680&DEAL_YMD=202610&pageNo=1&numOfRows=1000
//           GET /molit/rent?...   (응답은 국토부 XML 그대로)

// 매매는 기본 API가 막히면(활용신청 안 됨) '상세 자료' API로 자동 재시도
const UPSTREAM = {
  trade: [
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  ],
  rent: ['https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent'],
};
const API_NAME = {
  trade: '「국토교통부_아파트 매매 실거래가 자료」',
  rent: '「국토교통부_아파트 전월세 실거래가 자료」',
};
const VERSION = '1.1.0';
let preferred = { trade: 0, rent: 0 }; // 마지막으로 성공한 주소 기억
const mem = new Map(); // 같은 서버 인스턴스 안에서의 초고속 캐시

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-App-Token' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
}
function xml(body, source, ttl) {
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'X-Cache': source, 'Cache-Control': `public, max-age=${ttl}`, ...CORS },
  });
}

/** 한국시간 기준 YYYYMM (offset: 0=이번 달, 1=지난달) */
function kstYm(offset = 0, now = Date.now()) {
  const d = new Date(now + 9 * 3600 * 1000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'apt-alert-proxy', version: VERSION, keyConfigured: Boolean(env.MOLIT_KEY), kvCache: Boolean(env.CACHE) });
    }

    const m = url.pathname.match(/^\/molit\/(trade|rent)\/?$/);
    if (!m) return json({ error: '없는 주소입니다' }, 404);
    if (request.method !== 'GET') return json({ error: 'GET만 지원합니다' }, 405);
    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json({ error: '중계 서버 접근 토큰이 맞지 않아요' }, 403);
    }
    if (!env.MOLIT_KEY) return json({ error: '중계 서버에 국토부 API 키(MOLIT_KEY)가 설정되지 않았어요' }, 500);

    // ----- 입력 검증 (아무 요청이나 국토부로 넘기지 않도록) -----
    const api = m[1];
    const lawd = url.searchParams.get('LAWD_CD') || '';
    const ymd = url.searchParams.get('DEAL_YMD') || '';
    const page = Number(url.searchParams.get('pageNo') || 1);
    const rows = Number(url.searchParams.get('numOfRows') || 1000);
    if (!/^\d{5}$/.test(lawd)) return json({ error: 'LAWD_CD는 5자리 숫자' }, 400);
    if (!/^\d{6}$/.test(ymd) || ymd < '200601' || ymd > kstYm(0)) return json({ error: 'DEAL_YMD가 올바르지 않아요' }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 50) return json({ error: 'pageNo는 1~50' }, 400);
    if (!Number.isInteger(rows) || rows < 1 || rows > 1000) return json({ error: 'numOfRows는 1~1000' }, 400);

    // 이번 달·지난달은 신고가 계속 추가되므로 짧게, 그 이전 달은 길게 캐시
    const recent = ymd === kstYm(0) || ymd === kstYm(1);
    const ttl = recent ? 3 * 3600 : 7 * 86400;
    const cacheKey = `${api}:${lawd}:${ymd}:${page}:${rows}`;

    // 1) 메모리
    const hit = mem.get(cacheKey);
    if (hit && hit.exp > Date.now()) return xml(hit.body, 'MEMORY', ttl);

    // 2) Cache API (workers.dev 주소에서는 동작하지 않고, 연결한 도메인에서만 동작)
    const cacheReq = new Request(`https://apt-alert-cache.internal/${cacheKey}`);
    const edge = typeof caches !== 'undefined' ? caches.default : null;
    if (edge) {
      const r = await edge.match(cacheReq);
      if (r) return xml(await r.text(), 'EDGE', ttl);
    }

    // 3) KV
    if (env.CACHE) {
      const v = await env.CACHE.get(cacheKey);
      if (v) {
        remember(cacheKey, v, ttl);
        return xml(v, 'KV', ttl);
      }
    }

    // 4) 국토부 호출
    const key = String(env.MOLIT_KEY).trim();
    const encKey = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
    const urls = UPSTREAM[api];
    const order = [preferred[api], ...urls.keys()].filter((v, i, a) => a.indexOf(v) === i);
    let body = '';
    let reason = '';
    let ok = false;
    for (const idx of order) {
      try {
        const res = await fetch(`${urls[idx]}?serviceKey=${encKey}&LAWD_CD=${lawd}&DEAL_YMD=${ymd}&pageNo=${page}&numOfRows=${rows}`);
        body = await res.text();
        if (/<resultCode>\s*0{2,3}\s*<\/resultCode>/.test(body)) {
          ok = true;
          preferred[api] = idx;
          break;
        }
        reason = (body.match(/<returnAuthMsg>([^<]*)</) || body.match(/<resultMsg>([^<]*)</) || [])[1] || `HTTP ${res.status}`;
        // 키 미등록일 때만 다음 주소 시도, 그 외 오류(한도 초과 등)는 바로 중단
        if (!/NOT_REGISTERED|등록되지 않은|SERVICE_KEY/i.test(reason)) break;
      } catch (e) {
        reason = '국토부 서버 연결 실패';
      }
    }

    if (!ok) {
      // 키 값은 절대 노출하지 않음
      const msg = /LIMITED_NUMBER/.test(reason)
        ? '중계 서버의 오늘 국토부 API 호출 한도가 초과됐어요. 내일 다시 시도해 주세요.'
        : /NOT_REGISTERED|등록되지 않은|SERVICE_KEY/i.test(reason)
          ? `중계 서버의 국토부 API 키가 ${API_NAME[api]}에 등록되지 않았어요. 공공데이터포털에서 이 API를 활용신청해 주세요. (승인 직후면 1~2시간 뒤 다시 시도)`
          : `중계 서버의 국토부 API 오류: ${String(reason).slice(0, 80)}`;
      return json({ error: msg }, 502);
    }

    remember(cacheKey, body, ttl);
    if (edge) ctx.waitUntil(edge.put(cacheReq, new Response(body, { headers: { 'Cache-Control': `max-age=${ttl}` } })));
    if (env.CACHE) ctx.waitUntil(env.CACHE.put(cacheKey, body, { expirationTtl: ttl }));
    return xml(body, 'MISS', ttl);
  },
};

function remember(k, body, ttl) {
  if (mem.size > 300) mem.delete(mem.keys().next().value);
  mem.set(k, { body, exp: Date.now() + Math.min(ttl, 3600) * 1000 });
}
