import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { createService } from '../server/service.js';
import { createAlerts } from '../server/alerts.js';
import { assignDealKeys, complexIdOf, complexKeyOf } from '../server/molit.js';

const NOW = new Date(2026, 10, 12, 10);
const CID = complexIdOf(complexKeyOf('11650', '반포동', '1', '테스트아파트'));
const OTHER = complexIdOf(complexKeyOf('11650', '반포동', '2', '다른아파트'));

function fakeMolit(state) {
  const fetchMonth = async (api, lawd, ym) =>
    assignDealKeys(state[api].filter((d) => d.date.replace('-', '').slice(0, 6) === ym).map((d) => ({ ...d })));
  return {
    demo: false,
    fetchMonth,
    async fetchMonths(api, lawd, n) {
      const out = [];
      for (const ym of ['202611', '202610', '202609', '202608', '202607', '202606'].slice(0, n)) out.push(...(await fetchMonth(api, lawd, ym)));
      return out;
    },
  };
}
const trade = (o) => ({ type: 'trade', complexId: CID, aptNm: '테스트아파트', umdNm: '반포동', jibun: '1', area: 84.9, floor: 5, price: 300000, canceled: false, ...o });

function setup() {
  const state = {
    trade: [trade({ date: '2026-11-01' }), trade({ date: '2026-09-20', price: 290000 }), trade({ date: '2026-10-25', complexId: OTHER, aptNm: '다른아파트' })],
    rent: [{ type: 'jeonse', complexId: CID, aptNm: '테스트아파트', umdNm: '반포동', jibun: '1', area: 84.9, floor: 3, deposit: 150000, monthlyRent: 0, date: '2026-11-02', canceled: false }],
  };
  const store = createStore(null);
  const molit = fakeMolit(state);
  const pushed = [];
  const push = { sendToUser: async (u, p) => pushed.push({ u, p }) };
  const service = createService(molit);
  const alerts = createAlerts({ store, molit, service, push, now: () => NOW, log: { error() {} } });
  return { state, store, alerts, pushed };
}
const U = '00000000-0000-0000-0000-000000000001';

test('구독 시 최근 한 달 거래를 즉시 알림', async () => {
  const { alerts, pushed, store } = setup();
  const { recent } = await alerts.subscribe(U, { lawdCd: '11650', complexId: CID, type: 'trade' });
  assert.equal(recent.length, 1); // 09-20 거래는 30일 이전
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].p.title, /테스트아파트 매매 알림 시작/);
  assert.equal(store.data.notifications[0].kind, 'recent');
});

test('새로 신고된 거래만 알림, 다른 단지/유형은 제외', async () => {
  const { state, alerts, pushed } = setup();
  await alerts.subscribe(U, { lawdCd: '11650', complexId: CID, type: 'trade' });
  pushed.length = 0;

  let r = await alerts.poll();
  assert.equal(r.notificationsSent, 0); // 변화 없음

  state.trade.push(trade({ date: '2026-11-10', price: 310000, floor: 9 }));
  state.trade.push(trade({ date: '2026-11-10', complexId: OTHER, aptNm: '다른아파트' }));
  state.rent.push({ ...state.rent[0], date: '2026-11-11' });
  r = await alerts.poll();
  assert.equal(r.notificationsSent, 1);
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].p.title, /새 실거래 1건/);
  assert.match(pushed[0].p.body, /31억/);

  r = await alerts.poll(); // 같은 거래는 다시 알리지 않음
  assert.equal(r.notificationsSent, 0);
});

test('거래 해제 감지', async () => {
  const { state, alerts, pushed } = setup();
  await alerts.subscribe(U, { lawdCd: '11650', complexId: CID, type: 'trade' });
  pushed.length = 0;
  state.trade[0].canceled = true;
  await alerts.poll();
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].p.title, /거래 해제/);
});

test('중복 구독 방지 / 해제', async () => {
  const { alerts, store } = setup();
  const a = await alerts.subscribe(U, { lawdCd: '11650', complexId: CID, type: 'jeonse' });
  const b = await alerts.subscribe(U, { lawdCd: '11650', complexId: CID, type: 'jeonse' });
  assert.equal(a.subscription.id, b.subscription.id);
  assert.equal(alerts.unsubscribe(U, a.subscription.id), true);
  assert.equal(store.data.subscriptions.length, 0);
});

test('없는 단지 구독은 404', async () => {
  const { alerts } = setup();
  await assert.rejects(alerts.subscribe(U, { lawdCd: '11650', complexId: 'nope', type: 'trade' }), (e) => e.status === 404);
});
