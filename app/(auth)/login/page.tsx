'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { loginWithEmail, resetPassword } from '@/lib/firebase/auth'
import { readLastPath } from '@/lib/pwa/lastPath'
import { useToast } from '@/components/ui/Toast'
import { setWelcomeFlash } from '@/lib/notifications/welcomeFlash'

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}

export default function LoginPage() {
  const { error: errorToast } = useToast()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetStatus, setResetStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [resetError, setResetError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.currentTarget)
    const email = form.get('email') as string
    try {
      const user = await loginWithEmail(email, form.get('password') as string)
      const verifyRes = await fetch('/api/auth/verify', { cache: 'no-store' })
      if (!verifyRes.ok) {
        const error = new Error('Could not verify login session') as Error & { code?: string }
        error.code = 'app/session-verify-failed'
        throw error
      }
      const verifyData = await verifyRes.json()
      const role = verifyData?.role
      const rawName = user?.displayName?.trim() || verifyData?.name?.trim() || ''
      const displayName =
        rawName ||
        (email.includes('@') ? email.split('@')[0] : email) ||
        'friend'
      const fallback = role === 'admin' ? '/admin/dashboard' : '/portal/dashboard'
      const saved = readLastPath()
      const allowedPrefix = role === 'admin' ? '/admin' : '/portal'
      const target =
        saved && (saved === allowedPrefix || saved.startsWith(allowedPrefix + '/') || saved.startsWith(allowedPrefix + '?'))
          ? saved
          : fallback
      setWelcomeFlash({ name: displayName, email })
      window.location.assign(target)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? ''
      let message: string
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        message = 'Incorrect password.'
      } else if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        message = 'No account found with that email.'
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many attempts. Wait a few minutes and try again.'
      } else if (code === 'auth/unauthorized-domain') {
        message = 'Sign-in is not authorised from this domain. Contact support.'
      } else if (code === 'auth/network-request-failed') {
        message = 'Network error. Check your connection.'
      } else if (code === 'app/session-cookie-failed' || code === 'app/session-verify-failed') {
        message = 'Signed in, but the portal session could not be created. Please refresh and try again.'
      } else {
        message = `Sign-in failed (${code || 'unknown error'}).`
      }
      setError(message)
      errorToast(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setResetStatus('loading')
    setResetError('')
    try {
      await resetPassword(resetEmail)
      setResetStatus('sent')
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        setResetError('No account found with that email address.')
      } else if (code === 'auth/too-many-requests') {
        setResetError('Too many attempts. Wait a few minutes and try again.')
      } else if (code === 'auth/unauthorized-domain') {
        setResetError('Reset not authorised from this domain. Contact support.')
      } else if (code === 'auth/network-request-failed') {
        setResetError('Network error. Check your connection.')
      } else {
        setResetError(`Could not send reset email (${code || 'unknown error'}).`)
      }
      setResetStatus('error')
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 md:px-10 bg-[var(--color-pib-bg)] overflow-hidden">
      <div className="absolute inset-0 pib-mesh pointer-events-none" />
      <div className="absolute inset-0 pib-grid-bg pointer-events-none opacity-40" />

      <div className="relative w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 mb-8 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
        >
          <Image src="/pib-logo-512.png" alt="Partners in Biz" width={28} height={28} className="rounded-md object-contain" />
          <span className="font-display text-lg leading-none">Partners in Biz</span>
        </Link>

        <div className="bento-card !p-8 md:!p-10">
          {!showReset ? (
            <>
              <p className="eyebrow">Client portal</p>
              <h1 className="font-display text-3xl md:text-4xl mt-2 mb-2">Welcome back.</h1>
              <p className="text-sm text-[var(--color-pib-text-muted)] mb-8">
                Sign in to access your projects, reports, and conversations with the team.
              </p>

              <form method="post" action="/login" onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <label className="pib-label">Email</label>
                  <input name="email" type="email" required autoComplete="email" className="pib-input" />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="pib-label !mb-0">Password</label>
                    <button
                      type="button"
                      onClick={() => setShowReset(true)}
                      className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] transition-colors"
                    >
                      Forgot?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      className="pib-input pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-[#FCA5A5] bg-[#FCA5A5]/10 border border-[#FCA5A5]/30 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-pib-accent justify-center mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                  {!loading && <span className="material-symbols-outlined text-base">arrow_forward</span>}
                </button>
              </form>

              <p className="text-xs text-[var(--color-pib-text-muted)] mt-8 text-center">
                Don&rsquo;t have an account?{' '}
                <Link href="/start-a-project" className="text-[var(--color-pib-accent-hover)] hover:text-[var(--color-pib-accent)] transition-colors">
                  Start a project
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Reset password</p>
              <h1 className="font-display text-3xl md:text-4xl mt-2 mb-2">Forgot it? Happens.</h1>
              <p className="text-sm text-[var(--color-pib-text-muted)] mb-8">
                Enter your email and we&rsquo;ll send a link to reset your password.
              </p>

              {resetStatus === 'sent' ? (
                <div className="flex flex-col gap-5">
                  <p className="text-sm text-[var(--color-pib-success)] bg-[var(--color-pib-success)]/10 border border-[var(--color-pib-success)]/30 rounded-lg px-3 py-2.5">
                    Reset email sent — check your inbox.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReset(false)
                      setResetStatus('idle')
                      setResetEmail('')
                    }}
                    className="btn-pib-accent justify-center"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReset} className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <label className="pib-label">Email</label>
                    <input
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="pib-input"
                    />
                  </div>
                  {resetStatus === 'error' && (
                    <p className="text-sm text-[#FCA5A5] bg-[#FCA5A5]/10 border border-[#FCA5A5]/30 rounded-lg px-3 py-2">
                      {resetError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={resetStatus === 'loading'}
                    className="btn-pib-accent justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resetStatus === 'loading' ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReset(false)
                      setResetStatus('idle')
                      setResetError('')
                    }}
                    className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors mt-1"
                  >
                    ← Back to sign in
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
