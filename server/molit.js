// 국토교통부 아파트 실거래가 OpenAPI 클라이언트 (공공데이터포털 data.go.kr)
//  - 매매: RTMSDataSvcAptTrade / getRTMSDataSvcAptTrade
//  - 전월세: RTMSDataSvcAptRent / getRTMSDataSvcAptRent
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { demoFetchMonth } from './demo.js';

export const ENDPOINTS = {
  trade: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
  rent: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
};

// 거래 유형: 매매(trade) / 전세(jeonse) / 월세(monthly)
export const DEAL_TYPES = { trade: '매매', jeonse: '전세', monthly: '월세' };
export const apiForType = (type) => (type === 'trade' ? 'trade' : 'rent');

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // 모든 값은 문자열로 받고 직접 변환 (지번 '0012' 같은 값 보존)
  trimValues: true,
  isArray: (name, jpath) => jpath === 'response.body.items.item',
});

export class MolitApiError extends Error {
  constructor(code, message) {
    super(`[MOLIT ${code}] ${message}`);
    this.code = code;
  }
}

/** XML 응답 → { items, totalCount } */
export function parseResponse(xml) {
  const doc = parser.parse(xml);
  // 인증키 오류 등은 OpenAPI_ServiceResponse 형식으로 옴
  if (doc.OpenAPI_ServiceResponse) {
    const h = doc.OpenAPI_ServiceResponse.cmmMsgHeader || {};
    throw new MolitApiError(h.returnReasonCode || 'ERR', h.returnAuthMsg || h.errMsg || 'API error');
  }
  const res = doc.response;
  if (!res) throw new MolitApiError('PARSE', 'Unexpected response format');
  const code = String(res.header?.resultCode ?? '');
  if (code !== '00' && code !== '000') {
    throw new MolitApiError(code || 'ERR', res.header?.resultMsg || 'API error');
  }
  const body = res.body || {};
  const items = body.items && body.items.item ? body.items.item : [];
  return { items, totalCount: Number(body.totalCount || 0) };
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const pad2 = (n) => String(n).padStart(2, '0');

/** 단지 식별 키: 법정동 + 지번 + 단지명 (매매/전월세 API 공통으로 존재하는 필드) */
export function complexKeyOf(lawdCd, umdNm, jibun, aptNm) {
  return [lawdCd, str(umdNm), str(jibun), str(aptNm).replace(/\s+/g, '')].join('|');
}
export function complexIdOf(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function base(lawdCd, it) {
  const key = complexKeyOf(lawdCd, it.umdNm, it.jibun, it.aptNm);
  return {
    complexId: complexIdOf(key),
    aptNm: str(it.aptNm),
    umdNm: str(it.umdNm),
    jibun: str(it.jibun),
    buildYear: num(it.buildYear) || null,
    area: num(it.excluUseAr), // 전용면적(㎡)
    floor: num(it.floor),
    date: `${num(it.dealYear)}-${pad2(num(it.dealMonth))}-${pad2(num(it.dealDay))}`,
  };
}

export function normalizeTrade(lawdCd, it) {
  return {
    ...base(lawdCd, it),
    type: 'trade',
    price: num(it.dealAmount), // 만원
    dong: str(it.aptDong),
    dealingGbn: str(it.dealingGbn), // 중개거래/직거래
    canceled: str(it.cdealType) === 'O', // 해제 여부
    cancelDate: str(it.cdealDay),
  };
}

export function normalizeRent(lawdCd, it) {
  const monthlyRent = num(it.monthlyRent);
  return {
    ...base(lawdCd, it),
    type: monthlyRent > 0 ? 'monthly' : 'jeonse',
    deposit: num(it.deposit), // 만원
    monthlyRent, // 만원
    contractType: str(it.contractType), // 신규/갱신
    contractTerm: str(it.contractTerm),
    canceled: false,
  };
}

/** 거래 고유 키 (동일 조건 거래가 여러 건이면 #n 으로 구분) */
export function assignDealKeys(deals) {
  const seen = new Map();
  for (const d of deals) {
    const amount = d.type === 'trade' ? d.price : `${d.deposit}/${d.monthlyRent}`;
    const k = [d.type, d.complexId, d.date, d.area, d.floor, amount, d.dong || ''].join('|');
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    d.key = `${k}#${n}`;
  }
  return deals;
}

// ---------------------------------------------------------------------------

function encodeKey(key) {
  // 공공데이터포털은 Encoding/Decoding 키를 둘 다 줌. 이미 인코딩된 키는 그대로 사용.
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

async function fetchMonthLive(api, lawdCd, ymd, serviceKey) {
  const rows = 1000;
  const all = [];
  for (let page = 1; page < 50; page++) {
    const url = `${ENDPOINTS[api]}?serviceKey=${encodeKey(serviceKey)}&LAWD_CD=${lawdCd}&DEAL_YMD=${ymd}&pageNo=${page}&numOfRows=${rows}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (!res.ok && !text.trim().startsWith('<')) throw new MolitApiError(res.status, text.slice(0, 200));
    const { items, totalCount } = parseResponse(text);
    all.push(...items);
    if (items.length === 0 || all.length >= totalCount) break;
  }
  return all;
}

export function createMolitClient({ serviceKey, demo = !serviceKey, recentTtlMs = 60 * 60 * 1000, now = () => new Date() } = {}) {
  const cache = new Map(); // `${api}:${lawd}:${ymd}` -> { at, deals, promise }

  async function fetchMonth(api, lawdCd, ymd, { force = false } = {}) {
    const ck = `${api}:${lawdCd}:${ymd}`;
    const hit = cache.get(ck);
    const ttl = isRecentMonth(ymd, now()) ? recentTtlMs : 7 * 24 * 3600 * 1000;
    if (!force && hit) {
      if (hit.promise) return hit.promise;
      if (now() - hit.at < ttl) return hit.deals;
    }
    const promise = (async () => {
      const items = demo ? demoFetchMonth(api, lawdCd, ymd, now()) : await fetchMonthLive(api, lawdCd, ymd, serviceKey);
      const normalize = api === 'trade' ? normalizeTrade : normalizeRent;
      return assignDealKeys(items.map((it) => normalize(lawdCd, it)));
    })();
    cache.set(ck, { ...hit, promise });
    try {
      const deals = await promise;
      cache.set(ck, { at: now(), deals });
      return deals;
    } catch (e) {
      if (hit && hit.deals) cache.set(ck, hit);
      else cache.delete(ck);
      throw e;
    }
  }

  async function fetchMonths(api, lawdCd, months, opts) {
    const yms = recentYms(months, now());
    const out = [];
    // 동시 요청 제한(4)
    for (let i = 0; i < yms.length; i += 4) {
      const chunk = await Promise.all(yms.slice(i, i + 4).map((ym) => fetchMonth(api, lawdCd, ym, opts)));
      chunk.forEach((d) => out.push(...d));
    }
    return out;
  }

  return { fetchMonth, fetchMonths, demo };
}

/** 이번 달 포함 최근 n개월의 YYYYMM 목록 */
export function recentYms(n, today = new Date()) {
  const out = [];
  const d = new Date(today.getFullYear(), today.getMonth(), 1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}${pad2(d.getMonth() + 1)}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function isRecentMonth(ymd, today) {
  // 실거래 신고기한(계약 후 30일) 때문에 이번 달·지난달 데이터는 계속 바뀜
  return recentYms(2, today).includes(ymd);
}
