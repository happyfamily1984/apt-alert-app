import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../worker/worker.js';

const OK = fs.readFileSync(new URL('./fixtures/trade.xml', import.meta.url), 'utf8');
const ctx = { waitUntil() {} };
let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (String(u).includes('serviceKey=bad')) return new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>');
    return new Response(OK);
  };
});
const kv = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => m.set(k, v) }; };
const req = (path, headers) => new Request(`https://x.workers.dev${path}`, { headers });
const ym = (() => { const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

test('상태 확인', async () => {
  const r = await worker.fetch(req('/'), { MOLIT_KEY: 'k' }, ctx);
  assert.deepEqual((await r.json()).keyConfigured, true);
});

test('국토부 응답 중계 + 캐시 (키는 서버에서만 붙음)', async () => {
  const env = { MOLIT_KEY: 'abc+def=', CACHE: kv() };
  const p = `/molit/trade?LAWD_CD=11650&DEAL_YMD=202401&pageNo=1&numOfRows=1000`;
  const r1 = await worker.fetch(req(p), env, ctx);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('X-Cache'), 'MISS');
  assert.match(await r1.text(), /래미안/);
  assert.match(calls[0], /serviceKey=abc%2Bdef%3D&LAWD_CD=11650&DEAL_YMD=202401/);
  const r2 = await worker.fetch(req(p), env, ctx);
  assert.equal(r2.headers.get('X-Cache'), 'MEMORY');
  assert.equal(calls.length, 1); // 두 번째는 국토부 호출 없음
});

test('입력 검증', async () => {
  const env = { MOLIT_KEY: 'k' };
  for (const p of ['/molit/trade?LAWD_CD=1&DEAL_YMD=202401', '/molit/trade?LAWD_CD=11650&DEAL_YMD=209901', '/molit/rent?LAWD_CD=11650&DEAL_YMD=202401&numOfRows=5000', '/molit/etc?LAWD_CD=11650&DEAL_YMD=202401']) {
    const r = await worker.fetch(req(p), env, ctx);
    assert.ok(r.status >= 400, p);
  }
  assert.equal(calls.length, 0);
  assert.equal((await worker.fetch(req(`/molit/rent?LAWD_CD=11650&DEAL_YMD=${ym}`), env, ctx)).status, 200);
});

test('매매 기본 API 미등록이면 상세 자료 API로 재시도', async () => {
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (String(u).includes('RTMSDataSvcAptTrade/')) return new Response('<response><header><resultCode>30</resultCode><resultMsg>등록되지 않은 서비스키</resultMsg></header></response>');
    return new Response(OK);
  };
  const r = await worker.fetch(req('/molit/trade?LAWD_CD=11111&DEAL_YMD=202403'), { MOLIT_KEY: 'k' }, ctx);
  assert.equal(r.status, 200);
  assert.match(calls[1], /RTMSDataSvcAptTradeDev/);
  // 다음 요청은 성공했던 상세 API부터 시도
  await worker.fetch(req('/molit/trade?LAWD_CD=11112&DEAL_YMD=202403'), { MOLIT_KEY: 'k' }, ctx);
  assert.match(calls[2], /RTMSDataSvcAptTradeDev/);
});

test('키 오류는 JSON 에러, 키 미설정·토큰 불일치 차단', async () => {
  const r = await worker.fetch(req('/molit/trade?LAWD_CD=11651&DEAL_YMD=202402'), { MOLIT_KEY: 'bad' }, ctx);
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.match(body.error, /매매 실거래가 자료」에 등록되지 않았어요/);
  assert.doesNotMatch(JSON.stringify(body), /bad/);
  assert.equal((await worker.fetch(req('/molit/trade?LAWD_CD=11650&DEAL_YMD=202401'), {}, ctx)).status, 500);
  assert.equal((await worker.fetch(req('/molit/trade?LAWD_CD=11650&DEAL_YMD=202401'), { MOLIT_KEY: 'k', APP_TOKEN: 't' }, ctx)).status, 403);
  assert.equal((await worker.fetch(req('/molit/trade?LAWD_CD=11650&DEAL_YMD=202401', { 'X-App-Token': 't' }), { MOLIT_KEY: 'k', APP_TOKEN: 't' }, ctx)).status, 200);
});
