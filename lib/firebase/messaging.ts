/**
 * Firebase Cloud Messaging — client helpers.
 *
 * Lifecycle:
 *  1. `isPushSupported()` — bail early on browsers / contexts that can't push
 *     (Safari < 16.4, insecure origins, missing SW support, etc.).
 *  2. `requestPushPermission()` — asks the user, registers the FCM service
 *     worker, gets a token, and POSTs it to `/api/v1/push-tokens` so the
 *     server can deliver to this device later.
 *  3. `disablePush()` — deletes the token both locally and on the server.
 *  4. `onForegroundPush(handler)` — shows in-app toasts when a push arrives
 *     while the tab is open (the SW only fires for background pushes).
 *
 * VAPID key is read from `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (configure it in
 * Firebase console → Project settings → Cloud Messaging → Web Push certs).
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging'
import { getPublicFirebaseConfig, getPublicFirebaseVapidKey } from './publicConfig'

const firebaseConfig = getPublicFirebaseConfig()
const VAPID_KEY = getPublicFirebaseVapidKey()
const FCM_SW_URL = '/firebase-messaging-sw.js'
const LOCAL_TOKEN_KEY = 'pib.fcmToken'

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'ssr' | 'no-sw' | 'no-push' | 'insecure' | 'unsupported' | 'no-vapid' }

export async function getPushSupport(): Promise<PushSupport> {
  if (typeof window === 'undefined') return { supported: false, reason: 'ssr' }
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'no-sw' }
  if (!('PushManager' in window)) return { supported: false, reason: 'no-push' }
  if (!window.isSecureContext) return { supported: false, reason: 'insecure' }
  if (!VAPID_KEY) return { supported: false, reason: 'no-vapid' }
  try {
    const ok = await isSupported()
    return ok ? { supported: true } : { supported: false, reason: 'unsupported' }
  } catch {
    return { supported: false, reason: 'unsupported' }
  }
}

function getApp(): FirebaseApp {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
}

let messagingSingleton: Messaging | null = null
async function getMessagingInstance(): Promise<Messaging> {
  if (messagingSingleton) return messagingSingleton
  messagingSingleton = getMessaging(getApp())
  return messagingSingleton
}

/**
 * Register the FCM service worker, passing config via query string so the SW
 * can boot even before `/api/v1/firebase-config` is reachable.
 */
async function registerFcmServiceWorker(): Promise<ServiceWorkerRegistration> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(firebaseConfig)) {
    if (typeof v === 'string' && v) params.set(k, v)
  }
  const url = `${FCM_SW_URL}?${params.toString()}`
  return navigator.serviceWorker.register(url, { scope: '/firebase-cloud-messaging-push-scope' })
}

export async function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = 10000,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration

  const worker = registration.installing ?? registration.waiting
  if (!worker) {
    await registration.update().catch(() => undefined)
    if (registration.active) return registration
  }

  return new Promise((resolve, reject) => {
    const pendingWorker = registration.installing ?? registration.waiting
    if (!pendingWorker) {
      reject(new Error('No service worker is installing for push notifications.'))
      return
    }
    const activeWorker = pendingWorker

    const timeout = globalThis.setTimeout(() => {
      activeWorker.removeEventListener('statechange', onStateChange)
      reject(new Error('Timed out waiting for the push service worker to activate.'))
    }, timeoutMs)

    function onStateChange() {
      if (activeWorker.state !== 'activated') return
      globalThis.clearTimeout(timeout)
      activeWorker.removeEventListener('statechange', onStateChange)
      resolve(registration)
    }

    activeWorker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}

export type PushPermissionResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'denied' | 'dismissed' | 'unsupported' | 'no-vapid' | 'error'; error?: string }

export async function requestPushPermission(): Promise<PushPermissionResult> {
  const support = await getPushSupport()
  if (!support.supported) {
    return { ok: false, reason: support.reason === 'no-vapid' ? 'no-vapid' : 'unsupported' }
  }
  if (!VAPID_KEY) return { ok: false, reason: 'no-vapid' }

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' }
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' }

  try {
    const registration = await registerFcmServiceWorker()
    await waitForActiveServiceWorker(registration)
    const messaging = await getMessagingInstance()
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    })
    if (!token) return { ok: false, reason: 'error', error: 'No token returned' }

    localStorage.setItem(LOCAL_TOKEN_KEY, token)
    await saveTokenToServer(token)
    return { ok: true, token }
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
}

export async function disablePush(): Promise<void> {
  const cached = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_TOKEN_KEY) : null
  try {
    if (await isSupported().catch(() => false)) {
      const messaging = await getMessagingInstance()
      await deleteToken(messaging).catch(() => false)
    }
  } finally {
    if (cached) await removeTokenFromServer(cached).catch(() => undefined)
    if (typeof window !== 'undefined') localStorage.removeItem(LOCAL_TOKEN_KEY)
  }
}

export function getCachedPushToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(LOCAL_TOKEN_KEY)
}

export function onForegroundPush(handler: (payload: MessagePayload) => void): () => void {
  let unsub: (() => void) | undefined
  getMessagingInstance()
    .then((m) => {
      unsub = onMessage(m, handler)
    })
    .catch(() => undefined)
  return () => unsub?.()
}

async function saveTokenToServer(token: string): Promise<void> {
  const res = await fetch('/api/v1/push-tokens', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform: 'web', userAgent: navigator.userAgent }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Push token save failed: ${res.status} ${text}`)
  }
}

async function removeTokenFromServer(token: string): Promise<void> {
  await fetch(`/api/v1/push-tokens/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
}
