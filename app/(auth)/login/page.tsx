'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { loginWithEmail, resetPassword } from '@/lib/firebase/auth'
import { readLastPath } from '@/lib/pwa/lastPath'
import { useToast } from '@/components/ui/Toast'
import { setWelcomeFlash } from '@/lib/notifications/welcomeFlash'
import { Button, Field, Input, Notice } from '@/components/studio'
import { Wordmark } from '@/components/marketing/stage/StageChrome'
import { Plate } from '@/components/marketing/paper/Article'
import { ScrollIn } from '@/components/marketing/paper/ScrollIn'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'

export default function LoginPage() {
  const { error: errorToast } = useToast()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
        const sessionError = new Error('Could not verify login session') as Error & { code?: string }
        sessionError.code = 'app/session-verify-failed'
        throw sessionError
      }
      const verifyData = await verifyRes.json()
      const role = verifyData?.role
      const rawName = user?.displayName?.trim() || verifyData?.name?.trim() || ''
      const displayName =
        rawName || (email.includes('@') ? email.split('@')[0] : email) || 'friend'
      const fallback = role === 'admin' ? '/admin/dashboard' : '/portal/dashboard'
      const saved = readLastPath()
      const allowedPrefix = role === 'admin' ? '/admin' : '/portal'
      const target =
        saved &&
        (saved === allowedPrefix ||
          saved.startsWith(allowedPrefix + '/') ||
          saved.startsWith(allowedPrefix + '?'))
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
    <main className={`st-auth-frame${showReset ? '' : ' st-auth-frame--split'}`}>
      <Wordmark href="/" />

      <div className="st-auth-form">
        {!showReset ? (
          <>
            <header className="st-auth-form__head">
              <h1 className="sc-h1">Sign in.</h1>
              <p className="sc-dek">Access your projects, reports, and conversations with the team.</p>
            </header>

            <form method="post" action="/login" onSubmit={handleSubmit} className="st-auth-form__fields">
              <Field id="login-email" label="Email">
                <Input id="login-email" name="email" type="email" required autoComplete="email" />
              </Field>
              <Field id="login-password" label="Password">
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Button type="submit" block loading={loading}>
                {loading ? 'Signing in' : 'Sign in'}
              </Button>
            </form>

            <ul className="st-auth-links sc-tiny">
              <li>
                <button type="button" onClick={() => setShowReset(true)}>
                  Forgot password
                </button>
              </li>
              <li>
                <Link href="/register" prefetch={false} className="sc-link">
                  Create an account
                </Link>
              </li>
            </ul>
          </>
        ) : (
          <>
            <header className="st-auth-form__head">
              <h1 className="sc-h1">Reset password.</h1>
              <p className="sc-dek">Enter your email and we will send a link to reset your password.</p>
            </header>

            {resetStatus === 'sent' ? (
              <div className="st-auth-form__fields">
                <Notice tone="success">Reset email sent. Check your inbox.</Notice>
                <Button
                  type="button"
                  block
                  onClick={() => {
                    setShowReset(false)
                    setResetStatus('idle')
                    setResetEmail('')
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="st-auth-form__fields">
                <Field id="reset-email" label="Email">
                  <Input
                    id="reset-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                </Field>
                {resetStatus === 'error' ? <Notice tone="danger">{resetError}</Notice> : null}
                <Button type="submit" block loading={resetStatus === 'loading'}>
                  {resetStatus === 'loading' ? 'Sending' : 'Send reset link'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowReset(false)
                    setResetStatus('idle')
                    setResetError('')
                  }}
                >
                  Back to sign in
                </Button>
              </form>
            )}
          </>
        )}
      </div>

      {!showReset ? (
        <div className="st-auth-art sc-article__head-art" aria-hidden="false">
          <ScrollIn className="sc-in--head-art">
            <div className="sc-block" aria-hidden="true" />
            <Plate
              src={WORK_SHOTS.ahsLaw.src}
              alt={WORK_SHOTS.ahsLaw.alt}
              caption="AHS Law. Number one on Google in eight weeks."
              wide
              priority
            />
          </ScrollIn>
        </div>
      ) : null}
    </main>
  )
}
