/**
 * Service Worker — CTRL-P-ALT PWA
 * Network-first: online siempre sirve lo último; la caché es solo respaldo offline.
 */
const CACHE_NAME = 'ctrl-p-alt-v2'   // súbelo en cada cambio grande para bustear caché

self.addEventListener('install', event => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Supabase siempre a la red
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(request))
    return
  }

  // Todo lo demás: red primero, caché como respaldo
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && request.method === 'GET') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then(c => c || caches.match('/index.html')))
  )
})