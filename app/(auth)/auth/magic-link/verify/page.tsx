'use client'

// Landing page that completes the magic-link sign-in dance.
//
// Lands here from `/api/v1/auth/magic-link/verify` with `?customToken=X&redirect=Y`.
//
// Flow (browser side):
//   1. signInWithCustomToken(auth, customToken) → Firebase user
//   2. user.getIdToken() → ID token
//   3. POST { idToken } → /api/v1/auth/session  (sets the __session cookie)
//   4. location.replace(redirect ?? '/')
//
// Why this two-step dance: adminAuth.createSessionCookie requires a real signed-in
// ID token (from a client that has authenticated to Firebase). Custom tokens
// alone don't qualify, so the browser has to exchange custom → id before the
// server can mint the session cookie. See the API route docstring at
// app/api/v1/auth/magic-link/verify/route.ts.

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { ButtonLink, Notice } from '@/components/studio'
import { Wordmark } from '@/components/marketing/stage/StageChrome'

// useSearchParams() must be inside a Suspense boundary in Next.js 15+,
// otherwise the static prerender pass errors out. This page is fully dynamic
// anyway  -  there is nothing to prerender  -  so we also opt out of static
// rendering explicitly.
export const dynamic = 'force-dynamic'

function VerifyInner() {
  const searchParams = useSearchParams()
  const customToken = searchParams.get('customToken')
  const redirect = searchParams.get('redirect') || '/'

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!customToken) return

    let cancelled = false
    async function run() {
      try {
        const cred = await signInWithCustomToken(auth, customToken as string)
        const idToken = await cred.user.getIdToken()
        const res = await fetch('/api/v1/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.success) {
          throw new Error(body?.error ?? 'Sign-in failed')
        }
        if (!cancelled) {
          window.location.replace(redirect)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [customToken, redirect])

  if (!customToken) {
    return (
      <main className="st-auth-frame">
        <Wordmark href="/" />
        <div className="st-auth-form">
          <header className="st-auth-form__head">
            <h1 className="sc-h1">Check your email.</h1>
            <p className="sc-dek">This link is missing a token. Use the link from your email.</p>
          </header>
          <ul className="st-auth-links sc-tiny">
            <li>
              <Link href="/login" prefetch={false} className="sc-link">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="st-auth-frame">
        <Wordmark href="/" />
        <div className="st-auth-form">
          <header className="st-auth-form__head">
            <h1 className="sc-h1">Sign-in failed.</h1>
            <p className="sc-dek">The link may have expired. Request a new one from the document.</p>
          </header>
          <div className="st-auth-form__fields">
            <Notice tone="danger">{error}</Notice>
            <ButtonLink href="/login" block>
              Go to sign in
            </ButtonLink>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="st-auth-frame">
      <Wordmark href="/" />
      <div className="st-auth-form">
        <header className="st-auth-form__head">
          <h1 className="sc-h1">Signing you in.</h1>
          <p className="sc-dek">One moment while we finish the session.</p>
        </header>
      </div>
    </main>
  )
}

export default function MagicLinkVerifyLandingPage() {
  return (
    <Suspense
      fallback={
        <main className="st-auth-frame">
          <div className="st-auth-form">
            <header className="st-auth-form__head">
              <h1 className="sc-h1">Signing you in.</h1>
              <p className="sc-dek">One moment while we finish the session.</p>
            </header>
          </div>
        </main>
      }
    >
      <VerifyInner />
    </Suspense>
  )
}
