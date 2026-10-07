const CACHE = 'hub-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Network first, so updates show up right away. The cache is only an offline fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match(self.registration.scope)))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: 'Work Hub', body: e.data ? e.data.text() : '' }; }
  const jobs = [
    self.registration.showNotification(d.title || 'Work Hub', {
      body: d.body || '',
      tag: d.tag,
      icon: new URL('icons/icon-512.png', self.registration.scope).href,
      data: { url: new URL(d.url || '', self.registration.scope).href },
    }),
  ];
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
    jobs.push(self.navigator.setAppBadge(d.badge).catch(() => {}));
  }
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (c.navigate) c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
