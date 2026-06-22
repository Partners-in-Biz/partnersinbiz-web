'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { signInWithCustomToken } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/config'
import { copyToClipboard } from '@/lib/utils/clipboard'

function ImpersonateContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
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
    try {
      const auth = getClientAuth()
      await signInWithCustomToken(auth, token)
      setNotice('Signed in successfully. Redirecting to portal...')
      setTimeout(() => router.push('/portal'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. The token may have expired.')
    } finally {
      setSigningIn(false)
    }
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
            disabled={signingIn}
            className="pib-btn-primary text-sm font-label"
          >
            {signingIn ? 'Signing in...' : 'Sign in as this user'}
          </button>
          <Link href="/admin/users" className="pib-btn-ghost text-sm font-label">
            Back to users
          </Link>
        </div>

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
