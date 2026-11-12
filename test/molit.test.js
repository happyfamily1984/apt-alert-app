import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseResponse, normalizeTrade, normalizeRent, assignDealKeys, recentYms, MolitApiError } from '../server/molit.js';
import { formatManwon, formatDealLine } from '../server/format.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('매매 응답 파싱/정규화', () => {
  const { items, totalCount } = parseResponse(fx('trade.xml'));
  assert.equal(totalCount, 2);
  const [a, b] = items.map((it) => normalizeTrade('11650', it));
  assert.equal(a.price, 452000);
  assert.equal(a.date, '2026-11-03');
  assert.equal(a.area, 84.93);
  assert.equal(a.dong, '101');
  assert.equal(a.canceled, false);
  assert.equal(b.canceled, true);
  assert.equal(b.dealingGbn, '직거래');
});

test('전월세 정규화: 월세 0이면 전세', () => {
  const { items } = parseResponse(fx('rent.xml'));
  const [j, m] = items.map((it) => normalizeRent('11650', it));
  assert.equal(j.type, 'jeonse');
  assert.equal(j.deposit, 180000);
  assert.equal(m.type, 'monthly');
  assert.equal(m.monthlyRent, 320);
  assert.equal(m.contractType, '갱신');
});

test('매매와 전월세의 단지명 공백 차이가 있어도 같은 단지로 묶임', () => {
  const t = normalizeTrade('11650', parseResponse(fx('trade.xml')).items[0]);
  const r = normalizeRent('11650', parseResponse(fx('rent.xml')).items[0]);
  assert.equal(t.complexId, r.complexId);
});

test('단일 item도 배열로 파싱', () => {
  const xml = '<response><header><resultCode>000</resultCode></header><body><items><item><aptNm>A</aptNm></item></items><totalCount>1</totalCount></body></response>';
  assert.equal(parseResponse(xml).items.length, 1);
  const empty = '<response><header><resultCode>000</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>';
  assert.deepEqual(parseResponse(empty).items, []);
});

test('인증키 오류 응답은 예외', () => {
  const xml = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
  assert.throws(() => parseResponse(xml), MolitApiError);
  assert.throws(() => parseResponse('<response><header><resultCode>03</resultCode><resultMsg>NO DATA</resultMsg></header></response>'), /NO DATA/);
});

test('동일 조건 거래는 서로 다른 키', () => {
  const d = { type: 'trade', complexId: 'x', date: '2026-11-01', area: 84, floor: 3, price: 100 };
  const [a, b] = assignDealKeys([{ ...d }, { ...d }]);
  assert.notEqual(a.key, b.key);
});

test('recentYms / 금액 포맷', () => {
  assert.deepEqual(recentYms(3, new Date(2026, 0, 15)), ['202601', '202512', '202511']);
  assert.equal(formatManwon(152000), '15억 2,000만');
  assert.equal(formatManwon(90000), '9억');
  assert.equal(formatManwon(9500), '9,500만');
  assert.match(formatDealLine({ type: 'monthly', date: '2026-11-06', area: 59.97, floor: 15, deposit: 50000, monthlyRent: 320 }), /5억 \/ 월 320만/);
});
