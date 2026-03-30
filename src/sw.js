import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// SPA Navigation first
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// Precache assets
precacheAndRoute(self.__WB_MANIFEST || [])

// API calls — NetworkFirst, kein Cache
registerRoute(
  ({ url }) => url.pathname.includes('/functions/v1/'),
  new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 10 })
)

// Bilder — CacheFirst
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 })]
  })
)

// Fonts — CacheFirst
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 })]
  })
)

self.addEventListener('activate', () => self.clients.claim())
self.addEventListener('install', () => self.skipWaiting())
