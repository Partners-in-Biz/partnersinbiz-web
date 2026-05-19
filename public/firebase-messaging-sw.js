/*
 * Partners in Biz — Firebase Cloud Messaging service worker.
 *
 * This is intentionally a separate SW from sw.js because FCM requires its own
 * registration scope at /firebase-messaging-sw.js. Both can coexist — the page
 * controller (sw.js) handles caching + offline; this one handles background
 * push delivery.
 *
 * Firebase web config is injected via /api/v1/firebase-config so we don't have
 * to hardcode keys here. Falls back to query-string params when the API call
 * fails (offline install, dev environments).
 */

/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function cleanConfigValue(value) {
  return String(value || '').replace(/\\n/g, '\n').trim().replace(/^['"]|['"]$/g, '').trim()
}

function cleanFirebaseConfig(config) {
  return {
    apiKey: cleanConfigValue(config.apiKey),
    authDomain: cleanConfigValue(config.authDomain),
    projectId: cleanConfigValue(config.projectId),
    storageBucket: cleanConfigValue(config.storageBucket),
    messagingSenderId: cleanConfigValue(config.messagingSenderId),
    appId: cleanConfigValue(config.appId),
  }
}

async function getFirebaseConfig() {
  try {
    const res = await fetch('/api/v1/firebase-config', { credentials: 'omit' })
    if (res.ok) {
      const body = await res.json()
      if (body?.success && body.data?.apiKey) return cleanFirebaseConfig(body.data)
    }
  } catch {
    // network unavailable — fall back to URL params injected at registration
  }
  const params = new URL(self.location.href).searchParams
  return cleanFirebaseConfig({
    apiKey: params.get('apiKey') || '',
    authDomain: params.get('authDomain') || '',
    projectId: params.get('projectId') || '',
    storageBucket: params.get('storageBucket') || '',
    messagingSenderId: params.get('messagingSenderId') || '',
    appId: params.get('appId') || '',
  })
}

let messagingPromise = null
function getMessaging() {
  if (messagingPromise) return messagingPromise
  messagingPromise = getFirebaseConfig().then((config) => {
    if (!config.apiKey || !config.messagingSenderId) {
      console.warn('[fcm-sw] Missing Firebase config; background push will not work.')
      return null
    }
    self.firebase.initializeApp(config)
    const messaging = self.firebase.messaging()
    messaging.onBackgroundMessage((payload) => {
      const notif = payload.notification || {}
      const data = payload.data || {}
      const title = notif.title || data.title || 'Partners in Biz'
      const options = {
        body: notif.body || data.body || '',
        icon: notif.icon || '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: data.tag || payload.messageId || undefined,
        data: { url: data.url || data.link || '/', ...data },
      }
      self.registration.showNotification(title, options)
    })
    return messaging
  })
  return messagingPromise
}

// Force initialization so onBackgroundMessage hooks up before the first push.
getMessaging()

self.addEventListener('notificationclick', (event) => {
  const url = event.notification?.data?.url || '/'
  event.notification.close()
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of all) {
        if (c.url.includes(url)) {
          await c.focus()
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
