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

// Push Notifications empfangen
self.addEventListener('push', (event) => {
  let data = { title: 'DM Center', body: 'Neue Nachricht', url: '/dm-center' }
  try { data = event.data?.json() || data } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag: 'dm-notification',
      renotify: true,
      data: { url: data.url }
    })
  )
})

// Notification-Klick → App öffnen
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/dm-center'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(url))
      if (existing) return existing.focus()
      return clients.openWindow(url)
    })
  )
})
