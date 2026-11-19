// Service worker of the dashboard: push notifications (v2) and, since v6 (installable dashboard), an
// offline page when the network is gone. Nothing else is cached: tickets always come from the server.
const OFFLINE = 'datick-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE).then(c => c.addAll(['/offline.html', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('datick-offline-') && k !== OFFLINE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  // Only page loads, only when the network fails: the page « no connection »
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }

  const title   = data.title || 'Bot Ticketing';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.ticketId ? `ticket-${data.ticketId}` : 'notification',
    renotify: true,
    data: { ticketId: data.ticketId, url: data.ticketId ? `/tickets/${data.ticketId}` : '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const match = list.find(c => c.url.includes(url));
      if (match) return match.focus();
      return clients.openWindow(url);
    })
  );
});
