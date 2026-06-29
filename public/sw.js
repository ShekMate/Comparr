// Minimal service worker for Comparr PWA.
// Caches the app shell so the browser install prompt fires on Android/Chrome.
// Strategy: network-first for API calls, cache-first for static assets.

const CACHE_NAME = 'comparr-shell-v2'

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles/style.css',
  './styles/view-modes.css',
  './styles/main.css',
  './styles/mobile.css',
  './styles/desktop.css',
  './styles/tablet.css',
  './js/main.js',
  './js/ComparrAPI.js',
  './assets/logos/comparrlogo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // Always go network-first for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('{"error":"offline"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }))
    )
    return
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  )
})
