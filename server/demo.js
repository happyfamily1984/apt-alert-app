// 데모 모드: 서비스키 없이도 앱을 체험할 수 있도록 실제 API 응답과 같은 형태의 가짜 데이터를 생성
// - 시드 기반이라 같은 지역·월은 항상 같은 결과
// - 계약일 + 무작위 신고 지연(최대 30일) 이후에만 "신고"되어 노출 → 시간이 지나면 새 거래가 나타남

const NAMES_A = ['래미안', '자이', '힐스테이트', '푸르지오', '아이파크', 'e편한세상', '롯데캐슬', '더샵', '센트레빌', '현대', '삼성', '한신', '우성', '극동', '쌍용'];
const NAMES_B = ['퍼스티지', '파크', '센트럴', '리버뷰', '에듀포레', '1차', '2차', '3단지', '레이크', '포레스트', '시티', '하이츠', '프레스티지', ''];
const DONGS = ['신', '중앙', '서', '동', '남', '북', '대', '상', '하', '송', '도', '반'];
const AREAS = [39.6, 49.94, 59.97, 74.89, 84.97, 101.2, 114.8, 134.9];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function demoComplexes(lawdCd) {
  const r = rng(hash(`complex:${lawdCd}`));
  const count = 8 + Math.floor(r() * 7);
  // 서울 강남권은 비싸게, 지방은 저렴하게
  const regionFactor = lawdCd.startsWith('11') ? (['11650', '11680', '11710'].includes(lawdCd) ? 2.6 : 1.5) : lawdCd.startsWith('41') ? 0.9 : 0.55;
  const used = new Set();
  const list = [];
  for (let i = 0; i < count; i++) {
    let aptNm;
    do aptNm = `${pick(r, NAMES_A)}${pick(r, NAMES_B)}`.trim();
    while (used.has(aptNm));
    used.add(aptNm);
    list.push({
      aptNm,
      umdNm: `${pick(r, DONGS)}${pick(r, ['동', '1동', '2동'])}`.replace(/(\d)동$/, '$1가'),
      jibun: String(100 + Math.floor(r() * 900)),
      buildYear: 1986 + Math.floor(r() * 38),
      areas: AREAS.filter(() => r() < 0.45).slice(0, 4).concat([84.97]).filter((v, j, a) => a.indexOf(v) === j),
      pricePerM2: (900 + r() * 900) * regionFactor, // 만원/㎡
    });
  }
  return list;
}

const injected = new Map(); // `${api}:${lawd}:${ymd}` -> items[]

export function demoInject(api, lawdCd, item) {
  const k = `${api}:${lawdCd}:${item.dealYear}${String(item.dealMonth).padStart(2, '0')}`;
  if (!injected.has(k)) injected.set(k, []);
  injected.get(k).push(item);
}

/** 데모용: 특정 단지에 방금 신고된 거래를 하나 만들어 넣음 */
export function demoInjectDeal(lawdCd, complexAptNm, type, today = new Date()) {
  const c = demoComplexes(lawdCd).find((x) => x.aptNm === complexAptNm);
  if (!c) return null;
  const r = Math.random;
  const area = pick(r, c.areas);
  const common = {
    aptNm: c.aptNm, umdNm: c.umdNm, jibun: c.jibun, buildYear: String(c.buildYear),
    excluUseAr: String(area), floor: String(1 + Math.floor(r() * 25)),
    dealYear: String(today.getFullYear()), dealMonth: String(today.getMonth() + 1), dealDay: String(today.getDate()),
    sggCd: lawdCd,
  };
  const base = c.pricePerM2 * area;
  const item =
    type === 'trade'
      ? { ...common, dealAmount: fmt(base * (0.95 + r() * 0.1)), aptDong: `${101 + Math.floor(r() * 10)}`, dealingGbn: '중개거래', cdealType: '' }
      : type === 'jeonse'
        ? { ...common, deposit: fmt(base * 0.55 * (0.95 + r() * 0.1)), monthlyRent: '0', contractType: '신규', contractTerm: '' }
        : { ...common, deposit: fmt(base * 0.15), monthlyRent: String(Math.round((base * 0.003) / 5) * 5 || 50), contractType: '신규', contractTerm: '' };
  demoInject(type === 'trade' ? 'trade' : 'rent', lawdCd, item);
  return item;
}

export function demoFetchMonth(api, lawdCd, ymd, today = new Date()) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const daysInMonth = new Date(year, month, 0).getDate();
  const items = [];
  for (const c of demoComplexes(lawdCd)) {
    const r = rng(hash(`${api}:${lawdCd}:${ymd}:${c.aptNm}`));
    const n = Math.floor(r() * (api === 'trade' ? 4 : 7));
    // 월별 시세 변동(완만한 상승 + 노이즈)
    const monthsFromBase = (year - 2024) * 12 + month;
    const trend = 1 + monthsFromBase * 0.004;
    for (let i = 0; i < n; i++) {
      const day = 1 + Math.floor(r() * daysInMonth);
      const lagMin = Math.floor(r() * 30 * 1440);
      const reportedAt = new Date(year, month - 1, day, 9).getTime() + lagMin * 60000;
      const area = pick(r, c.areas);
      const floor = 1 + Math.floor(r() * 25);
      const basePrice = c.pricePerM2 * area * trend * (0.93 + r() * 0.14) * (floor < 3 ? 0.94 : 1);
      if (reportedAt > today.getTime()) continue; // 아직 신고 전
      const common = {
        aptNm: c.aptNm, umdNm: c.umdNm, jibun: c.jibun, buildYear: String(c.buildYear),
        excluUseAr: String(area), floor: String(floor),
        dealYear: String(year), dealMonth: String(month), dealDay: String(day), sggCd: lawdCd,
      };
      if (api === 'trade') {
        items.push({
          ...common,
          dealAmount: fmt(basePrice),
          aptDong: r() < 0.7 ? String(101 + Math.floor(r() * 12)) : '',
          dealingGbn: r() < 0.9 ? '중개거래' : '직거래',
          cdealType: r() < 0.03 ? 'O' : '',
          cdealDay: '',
        });
      } else {
        const isMonthly = r() < 0.45;
        items.push({
          ...common,
          deposit: fmt(isMonthly ? basePrice * (0.05 + r() * 0.2) : basePrice * (0.5 + r() * 0.12)),
          monthlyRent: isMonthly ? String(Math.max(30, Math.round((basePrice * 0.0028 * (0.8 + r() * 0.4)) / 5) * 5)) : '0',
          contractType: r() < 0.6 ? '신규' : '갱신',
          contractTerm: `${year}.${String(month).padStart(2, '0')}~${year + 2}.${String(month).padStart(2, '0')}`,
        });
      }
    }
  }
  items.push(...(injected.get(`${api}:${lawdCd}:${ymd}`) || []));
  return items;
}
