'use client'

import { useEffect } from 'react'

/**
 * Registers the PWA service worker (sw.js) once on mount.
 *
 * The FCM service worker (firebase-messaging-sw.js) is registered lazily by
 * `requestPushPermission()` only after the user opts in  -  that way visitors
 * who never grant push permission never pay the cost of loading Firebase.
 *
 * In dev we deliberately unregister so HMR isn't poisoned by a stale cache.
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => {
          if (r.active?.scriptURL.endsWith('/sw.js')) r.unregister()
        })
      })
      return
    }

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          console.warn('[pwa] SW registration failed', err)
        })
    }

    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })

    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
