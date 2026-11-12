// 단지 목록/거래 내역 조회 로직
import { apiForType } from './molit.js';

export function createService(molit, { complexMonths = 6 } = {}) {
  /** 시군구의 아파트 단지 목록 (최근 N개월 매매+전월세 거래가 있는 단지) */
  async function getComplexes(lawdCd) {
    const [trades, rents] = await Promise.all([
      molit.fetchMonths('trade', lawdCd, complexMonths),
      molit.fetchMonths('rent', lawdCd, complexMonths),
    ]);
    const map = new Map();
    for (const d of [...trades, ...rents]) {
      let c = map.get(d.complexId);
      if (!c) {
        c = { id: d.complexId, lawdCd, aptNm: d.aptNm, umdNm: d.umdNm, jibun: d.jibun, buildYear: d.buildYear, counts: { trade: 0, jeonse: 0, monthly: 0 }, lastDealDate: null, lastTradePrice: null, lastTradeDate: null };
        map.set(d.complexId, c);
      }
      if (!c.buildYear && d.buildYear) c.buildYear = d.buildYear;
      if (d.canceled) continue;
      c.counts[d.type]++;
      if (!c.lastDealDate || d.date > c.lastDealDate) c.lastDealDate = d.date;
      if (d.type === 'trade' && (!c.lastTradeDate || d.date > c.lastTradeDate)) {
        c.lastTradeDate = d.date;
        c.lastTradePrice = d.price;
      }
    }
    return [...map.values()].sort((a, b) => a.aptNm.localeCompare(b.aptNm, 'ko'));
  }

  async function getComplex(lawdCd, complexId) {
    return (await getComplexes(lawdCd)).find((c) => c.id === complexId) || null;
  }

  /** 단지의 특정 유형 거래 내역 (최신순) */
  async function getDeals(lawdCd, complexId, type, months = complexMonths, opts) {
    const all = await molit.fetchMonths(apiForType(type), lawdCd, months, opts);
    return all
      .filter((d) => d.complexId === complexId && d.type === type)
      .sort((a, b) => (a.date === b.date ? b.floor - a.floor : a.date < b.date ? 1 : -1));
  }

  return { getComplexes, getComplex, getDeals };
}

/** 기간 내 통계 */
export function summarize(deals) {
  const valid = deals.filter((d) => !d.canceled);
  if (!valid.length) return { count: 0 };
  const val = (d) => (d.type === 'trade' ? d.price : d.deposit);
  const vals = valid.map(val);
  const perPyeong = valid.map((d) => val(d) / (d.area / 3.3058));
  return {
    count: valid.length,
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    min: Math.min(...vals),
    max: Math.max(...vals),
    avgPerPyeong: Math.round(perPyeong.reduce((a, b) => a + b, 0) / perPyeong.length),
  };
}

export function daysAgo(n, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
