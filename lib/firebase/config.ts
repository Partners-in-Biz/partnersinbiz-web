import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  Auth,
} from 'firebase/auth'
import { getFirestore, Firestore } from 'firebase/firestore'
import { getPublicFirebaseConfig } from './publicConfig'

const firebaseConfig = getPublicFirebaseConfig()

function getApp(): FirebaseApp {
  return getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
}

// Tracks when persistence is fully configured. Must be awaited before sign-in
// to prevent a brief null auth event during the localStorage→IndexedDB migration
// that would cause the portal layout to redirect unauthenticated users to /login.
let _persistenceReady: Promise<void> | null = null

export function getClientAuth(): Auth {
  const a = getAuth(getApp())
  if (!_persistenceReady && typeof window !== 'undefined') {
    _persistenceReady = setPersistence(a, indexedDBLocalPersistence)
      .catch(() => setPersistence(a, browserLocalPersistence))
      .catch(() => setPersistence(a, browserSessionPersistence))
      .catch(() => {})
  }
  return a
}

export function waitForPersistence(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  getClientAuth() // ensure setup has started
  return _persistenceReady ?? Promise.resolve()
}

export function getClientDb(): Firestore {
  return getFirestore(getApp())
}

// Legacy named exports for backwards compatibility — initialised lazily via Proxy
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    return Reflect.get(getClientAuth(), prop)
  },
})

export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    return Reflect.get(getClientDb(), prop)
  },
})

// Shared Google sign-in provider used by the document edit-share flow and any
// future Google OAuth surfaces. Lives at module scope so a single instance is
// reused across components.
export const googleProvider = new GoogleAuthProvider()
