/**
 * Service Worker for CTRL-P-ALT PWA
 * Strategy: Network first for API calls, cache first for static assets
 */

const CACHE_NAME = 'ctrl-p-alt-v1'

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
]

// Install — pre-cache shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  )
  self.skipWaiting()
})

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// Fetch — network first, fall back to cache for navigation
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Always network for Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(request))
    return
  }

  // For navigation requests (page loads) — network first, cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache the fresh response
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // For static assets — cache first, network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
    })
  )
})