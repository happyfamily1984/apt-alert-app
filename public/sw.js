// 서비스 워커: 푸시 알림 수신 & 클릭 처리
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: '실거래 알리미', body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || '실거래 알리미', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/#/alerts' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate(url); return w.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
