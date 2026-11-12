// Web Push (VAPID) 발송
import * as webpush from 'web-push';

export function createPush({ store, publicKey, privateKey, subject = 'mailto:admin@example.com', log = console }) {
  const db = () => store.data;
  if (!publicKey || !privateKey) {
    // 환경변수가 없으면 최초 실행 시 키를 만들어 DB에 저장 (재시작해도 구독 유지)
    if (!db().vapid) {
      db().vapid = webpush.generateVAPIDKeys();
      store.save();
      log.log('[push] VAPID 키를 새로 생성했습니다 (data/db.json에 저장).');
    }
    ({ publicKey, privateKey } = db().vapid);
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  function register(userId, sub) {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw Object.assign(new Error('잘못된 푸시 구독 정보'), { status: 400 });
    }
    db().pushSubs = db().pushSubs.filter((p) => p.endpoint !== sub.endpoint);
    db().pushSubs.push({ userId, endpoint: sub.endpoint, keys: sub.keys, createdAt: new Date().toISOString() });
    store.save();
  }

  function unregister(userId, endpoint) {
    db().pushSubs = db().pushSubs.filter((p) => !(p.userId === userId && p.endpoint === endpoint));
    store.save();
  }

  async function sendToUser(userId, payload) {
    const targets = db().pushSubs.filter((p) => p.userId === userId);
    await Promise.all(
      targets.map(async (p) => {
        try {
          await webpush.sendNotification({ endpoint: p.endpoint, keys: p.keys }, JSON.stringify(payload), { TTL: 24 * 3600 });
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            unregister(userId, p.endpoint); // 만료된 구독 제거
          } else {
            log.error('[push] 발송 실패:', e.statusCode || '', e.body || e.message);
          }
        }
      }),
    );
    return targets.length;
  }

  return { publicKey, register, unregister, sendToUser };
}
