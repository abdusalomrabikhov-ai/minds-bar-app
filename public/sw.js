const CACHE = 'teamtask-v4';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/css/style.min.css?v=33',
  '/fonts/gotham_book.woff2?v=1',
  '/fonts/gotham_bold.woff2?v=1',
  '/favicon.ico',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only cache GET requests for same origin
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // API calls — network only, no cache
  if (url.pathname.startsWith('/api/')) return;

  // Versioned static assets (?v=N) are immutable — the same URL never changes
  // content, so cache-first lets the app boot offline instead of only
  // falling back to the index.html shell. New deploys bump ?v=, which is a
  // different URL and simply repopulates the cache.
  const isVersioned = url.searchParams.has('v') &&
    (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.startsWith('/fonts/'));

  if (isVersioned) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses for unversioned static assets (fonts w/o ?v=, etc.)
        if (res.ok && (url.pathname.startsWith('/css/') || url.pathname.startsWith('/fonts/'))) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
  );
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'TeamTask', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'TeamTask', {
      body: data.body || '',
      icon: '/img/logo.png',
      badge: '/favicon.ico',
      data: data.url ? { url: data.url } : {},
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const c = cs.find(w => w.url.includes(self.location.origin));
      if (c) { c.focus(); c.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
