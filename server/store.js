// 아주 단순한 JSON 파일 저장소 (소규모 개인/가족용). 규모가 커지면 SQLite/Postgres로 교체.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  subscriptions: [], // { id, userId, lawdCd, complexId, aptNm, umdNm, type, createdAt }
  pushSubs: [], // { userId, endpoint, keys, createdAt }
  notifications: [], // { id, userId, subscriptionId, title, body, deals, createdAt, read }
  seen: {}, // { 'trade:11680': { initializedAt, months: { '202611': { dealKey: 1 | 'canceled' } } } }
  vapid: null,
  lastPollAt: null,
});

export function createStore(file) {
  let data = EMPTY();
  if (file && fs.existsSync(file)) {
    try {
      data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      console.error('[store] DB 파일을 읽지 못했습니다. 새로 시작합니다:', e.message);
    }
  }
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  return {
    get data() {
      return data;
    },
    save() {
      if (!timer) timer = setTimeout(flush, 200);
    },
    flush,
  };
}
