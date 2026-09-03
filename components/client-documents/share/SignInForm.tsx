'use client'

import { useState } from 'react'
import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase/client'
import { PageTabs } from '@/components/ui/AppFoundation'
import { Button, Field, Input, Notice, Panel } from '@/components/studio'

export function SignInForm({
  redirectUrl,
  context,
  docTitle,
  onAuthenticated,
}: {
  redirectUrl: string
  context?: unknown
  docTitle?: string
  onAuthenticated: () => void
}) {
  const [tab, setTab] = useState<'email' | 'google'>('email')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/auth/magic-link/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectUrl, context, docTitle }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Failed to send')
      setSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function signInGoogle() {
    setBusy(true)
    setError(null)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const idToken = await result.user.getIdToken()
      const res = await fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Sign-in failed')
      onAuthenticated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Panel>
        <h1 className="sc-article__h2">Check your email.</h1>
        <p className="sc-body mt-4">
          We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
        </p>
      </Panel>
    )
  }

  return (
    <Panel>
      <h1 className="sc-article__h2 text-center">Sign in to continue.</h1>

      <div className="mt-8">
        <PageTabs
          variant="segmented"
          ariaLabel="Sign-in method"
          value={tab}
          onValueChange={(value) => setTab(value as 'email' | 'google')}
          tabs={[
            { value: 'email', label: 'Email link' },
            { value: 'google', label: 'Google' },
          ]}
        />
      </div>

      {tab === 'email' ? (
        <form onSubmit={sendMagicLink} className="st-stack mt-8">
          <Field id="edit-share-email" label="Email">
            <Input
              id="edit-share-email"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              aria-label="Email"
            />
          </Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" block loading={busy} disabled={busy || !email}>
            Send sign-in link
          </Button>
        </form>
      ) : (
        <div className="st-stack mt-8">
          <Button type="button" variant="secondary" block loading={busy} onClick={signInGoogle}>
            Continue with Google
          </Button>
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      )}
    </Panel>
  )
}
