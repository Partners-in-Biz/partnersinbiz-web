'use client'

/**
 * Impersonation banner (US-255).
 *
 * Reads the `pib_impersonation` sessionStorage marker (set by the impersonate
 * page before signInWithCustomToken) and renders a fixed top banner while an
 * admin is signed in as another user. The Exit button signs out of the
 * impersonated session, clears the marker, and routes to /login so the admin
 * can sign back in as themselves.
 *
 * Mount this anywhere it should be visible during impersonation. It renders
 * nothing when no marker is present, so it is safe to mount globally.
 */
import { useEffect, useState } from 'react'
import { signOut } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/config'

export const IMPERSONATION_KEY = 'pib_impersonation'

export interface ImpersonationMarker {
  targetUid: string
  targetEmail: string
  adminReturnHint?: string
  startedAt: string
}

function readMarker(): ImpersonationMarker | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(IMPERSONATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ImpersonationMarker
    if (!parsed?.targetUid) return null
    return parsed
  } catch {
    return null
  }
}

export default function ImpersonationBanner() {
  const [marker, setMarker] = useState<ImpersonationMarker | null>(null)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    setMarker(readMarker())

    // Keep in sync if another tab clears/sets the marker.
    function onStorage(e: StorageEvent) {
      if (e.key === IMPERSONATION_KEY) setMarker(readMarker())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  async function handleExit() {
    setExiting(true)
    try {
      const auth = getClientAuth()
      await signOut(auth)
    } catch {
      // Even if sign-out fails we still clear the marker and bounce to /login.
    } finally {
      try {
        window.sessionStorage.removeItem(IMPERSONATION_KEY)
      } catch {
        /* ignore */
      }
      window.location.href = '/login'
    }
  }

  if (!marker) return null

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[1000] flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium text-white shadow-md"
      style={{ background: '#b91c1c' }}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
        warning
      </span>
      <span className="truncate">
        Impersonating <strong>{marker.targetEmail || marker.targetUid}</strong>
        {marker.adminReturnHint ? (
          <span className="hidden sm:inline opacity-80"> — return to {marker.adminReturnHint} afterwards</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        className="ml-2 rounded-md bg-white/20 px-3 py-1 text-xs font-label uppercase tracking-wide hover:bg-white/30 disabled:opacity-60"
      >
        {exiting ? 'Exiting…' : 'Exit impersonation'}
      </button>
    </div>
  )
}
