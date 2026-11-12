// 금액(만원) → '15억 2,000만' / '9,500만'
export function formatManwon(v) {
  const n = Math.round(Number(v) || 0);
  const eok = Math.floor(n / 10000);
  const rest = n % 10000;
  if (eok && rest) return `${eok}억 ${rest.toLocaleString('en-US')}만`;
  if (eok) return `${eok}억`;
  return `${rest.toLocaleString('en-US')}만`;
}

export function formatDealPrice(d) {
  if (d.type === 'trade') return formatManwon(d.price);
  if (d.type === 'jeonse') return formatManwon(d.deposit);
  return `${formatManwon(d.deposit)} / 월 ${d.monthlyRent.toLocaleString('en-US')}만`;
}

export function formatDealLine(d) {
  const md = d.date.slice(5).replace('-', '/');
  return `${d.area}㎡ ${d.floor}층 · ${formatDealPrice(d)} · ${md} 계약${d.canceled ? ' (해제)' : ''}`;
}
