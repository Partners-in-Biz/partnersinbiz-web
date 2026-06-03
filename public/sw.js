/*
 * Partners in Biz — PWA service worker.
 *
 * Strategy: tiny app-shell precache + runtime caching with sensible defaults.
 * - HTML navigations: network-first, fall back to the offline page.
 * - Next build assets: bypass. They are immutable and already handled by
 *   Vercel/browser caching, and a SW fallback can hide the real network error.
 * - Public static assets: stale-while-revalidate.
 * - Admin/portal/API: bypass entirely (always go to network).
 *
 * Bump CACHE_VERSION whenever you change the SW logic so old caches purge.
 */

const CACHE_VERSION = 'pib-v2-static-bypass'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll(
          PRECACHE_URLS.map((u) => new Request(u, { cache: 'reload' })),
        ),
      )
      .then(() => self.skipWaiting())
      .catch(() => {
        // Precache is best-effort — never block install on a missing asset.
      }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

function isBypassPath(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/portal') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/data')
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (isBypassPath(url)) return

  // HTML navigations: network-first, then cache, then /offline.
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(RUNTIME_CACHE)
          cache.put(req, fresh.clone())
          return fresh
        } catch {
          const cached = await caches.match(req)
          if (cached) return cached
          const offline = await caches.match('/offline')
          if (offline) return offline
          return new Response('Offline', { status: 503, statusText: 'Offline' })
        }
      })(),
    )
    return
  }

  // Static-ish GETs: stale-while-revalidate.
  const isStatic =
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/images/') ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname)

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE)
        const cached = await cache.match(req)
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone())
            return res
          })
          .catch(() => null)
        return cached || (await networkPromise) || fetch(req)
      })(),
    )
  }
})

// Allow the page to trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

// Click on a push notification → focus an existing tab or open one.
self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data?.url || '/'
  event.notification.close()
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = all.find((c) => c.url.includes(url))
      if (existing) {
        await existing.focus()
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
