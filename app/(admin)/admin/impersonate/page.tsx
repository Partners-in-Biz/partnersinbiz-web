'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { signInWithCustomToken } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/config'
import { copyToClipboard } from '@/lib/utils/clipboard'
import ImpersonationBanner, { IMPERSONATION_KEY } from '@/components/admin/users/ImpersonationBanner'

function ignoreBestEffortFailure() {
  return undefined
}

function ImpersonateContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''
  const targetEmail = searchParams.get('email') ?? ''
  const targetUid = searchParams.get('uid') ?? ''
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleCopy() {
    if (!token) return
    setCopying(true)
    try {
      await copyToClipboard(token)
      setCopied(true)
      setNotice('Token copied to clipboard.')
      setTimeout(() => setCopied(false), 3000)
    } catch {
      setError('Failed to copy — select the token text manually.')
    } finally {
      setCopying(false)
    }
  }

  async function handleSignIn() {
    if (!token) return
    setSigningIn(true)
    setError(null)
    setNotice(null)
    // Set the impersonation marker BEFORE replacing the session so the banner
    // can render immediately and the admin always has an exit affordance.
    try {
      window.sessionStorage.setItem(
        IMPERSONATION_KEY,
        JSON.stringify({
          targetUid: targetUid || 'unknown',
          targetEmail: targetEmail || '',
          adminReturnHint: 'your admin account',
          startedAt: new Date().toISOString(),
        }),
      )
    } catch { ignoreBestEffortFailure() }
    try {
      const auth = getClientAuth()
      await signInWithCustomToken(auth, token)
      setSignedIn(true)
      setNotice('Signed in successfully. Use the banner or button below to exit when done.')
    } catch (err) {
      // Roll back the marker if sign-in never completed.
      try {
        window.sessionStorage.removeItem(IMPERSONATION_KEY)
      } catch { ignoreBestEffortFailure() }
      setError(err instanceof Error ? err.message : 'Sign-in failed. The token may have expired.')
    } finally {
      setSigningIn(false)
    }
  }

  function handleExit() {
    try {
      window.sessionStorage.removeItem(IMPERSONATION_KEY)
    } catch { ignoreBestEffortFailure() }
    // Sign out happens on /login; route there so the admin can sign back in.
    router.push('/login')
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          No token provided. Navigate here from the{' '}
          <Link href="/admin/users" className="underline">
            Users page
          </Link>{' '}
          via the Impersonate button.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Fixed banner — appears as soon as the impersonation marker is set */}
      <ImpersonationBanner />

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      <div className="pib-card p-5 space-y-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Firebase custom token
          </p>
          <p className="text-sm text-on-surface-variant">
            This token is valid for <strong className="text-on-surface">1 hour</strong>. Clicking
            &ldquo;Sign in as this user&rdquo; below will replace your current session. You will need
            to sign back in as yourself afterwards.
          </p>
        </div>

        {/* Token display */}
        <div className="relative">
          <pre className="pib-card bg-on-surface/5 p-4 text-[11px] font-mono break-all whitespace-pre-wrap text-on-surface-variant overflow-x-auto rounded-xl">
            {token}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            disabled={copying}
            className="absolute top-2 right-2 pib-btn-ghost text-xs font-label px-2 py-1"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn || signedIn}
            className="pib-btn-primary text-sm font-label"
          >
            {signedIn ? 'Signed in' : signingIn ? 'Signing in...' : 'Sign in as this user'}
          </button>
          {signedIn ? (
            <button
              type="button"
              onClick={handleExit}
              className="pib-btn-ghost text-sm font-label"
              style={{ borderColor: '#b91c1c', color: '#b91c1c' }}
            >
              Exit impersonation
            </button>
          ) : (
            <Link href="/admin/users" className="pib-btn-ghost text-sm font-label">
              Back to users
            </Link>
          )}
        </div>

        {signedIn && (
          <div className="pib-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-500">
            You are now signed in as{' '}
            <strong>{targetEmail || targetUid || 'this user'}</strong>. Open{' '}
            <Link href="/portal" className="underline">
              the portal
            </Link>{' '}
            to act as them. When finished, click <strong>Exit impersonation</strong> (or use the top
            banner) to return to the login screen and sign back in as yourself.
          </div>
        )}

        <p className="text-xs text-on-surface-variant/60">
          Signing in will call <code>signInWithCustomToken</code> with the Firebase client SDK and
          redirect you to <code>/portal</code>. Your existing admin session will be replaced. Sign
          out and back in to restore admin access.
        </p>
      </div>
    </div>
  )
}

export default function ImpersonatePage() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Admin / Impersonate
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Impersonate User</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">
          Use this token to sign in as the selected user for debugging purposes.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
            Loading...
          </div>
        }
      >
        <ImpersonateContent />
      </Suspense>
    </div>
  )
}
