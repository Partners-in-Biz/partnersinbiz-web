'use client'
export const dynamic = 'force-dynamic'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { ButtonLink, Notice } from '@/components/studio'
import { Wordmark } from '@/components/marketing/stage/StageChrome'

const ALLOWED_FIREBASE_HOSTS = [
  'partners-in-biz-85059.firebaseapp.com',
  'partners-in-biz-85059.web.app',
]

function isSafeFirebaseLink(raw: string): boolean {
  try {
    const url = new URL(raw)
    return ALLOWED_FIREBASE_HOSTS.includes(url.hostname) && url.pathname === '/__/auth/action'
  } catch {
    return false
  }
}

function ResetContent() {
  const params = useSearchParams()
  const raw = params.get('link') ?? ''
  const safe = isSafeFirebaseLink(raw)

  return (
    <main className="st-auth-frame">
      <Wordmark href="/" />

      <div className="st-auth-form">
        {safe ? (
          <>
            <header className="st-auth-form__head">
              <h1 className="sc-h1">Set your password.</h1>
              <p className="sc-dek">
                Continue to the secure page to set your password and activate your account.
              </p>
            </header>
            <div className="st-auth-form__fields">
              <a href={raw} className="st-btn st-btn--primary st-btn--block">
                Set password
              </a>
            </div>
            <ul className="st-auth-links sc-tiny">
              <li>
                <Link href="/login" prefetch={false} className="sc-link">
                  Sign in
                </Link>
              </li>
            </ul>
          </>
        ) : (
          <>
            <header className="st-auth-form__head">
              <h1 className="sc-h1">Link not valid.</h1>
              <p className="sc-dek">
                This setup link is missing or invalid. Request a new password reset from the login page.
              </p>
            </header>
            <div className="st-auth-form__fields">
              <Notice tone="warning">Ask for a fresh reset link from sign in.</Notice>
              <ButtonLink href="/login" block>
                Go to sign in
              </ButtonLink>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default function ResetPage() {
  return (
    <Suspense
      fallback={
        <main className="st-auth-frame">
          <div className="st-auth-form">
            <p className="sc-body">Loading.</p>
          </div>
        </main>
      }
    >
      <ResetContent />
    </Suspense>
  )
}
