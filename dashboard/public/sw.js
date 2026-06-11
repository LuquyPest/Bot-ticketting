self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }

  const title   = data.title || 'Bot Ticketing';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
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
