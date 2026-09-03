'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { registerWithEmail } from '@/lib/firebase/auth'
import { Button, Field, Input, Notice } from '@/components/studio'
import { Wordmark } from '@/components/marketing/stage/StageChrome'

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.currentTarget)
    const password = form.get('password') as string
    const confirm = form.get('confirm') as string
    if (password !== confirm) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }
    try {
      await registerWithEmail(form.get('email') as string, password, form.get('name') as string)
      router.push('/portal/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="st-auth-frame">
      <Wordmark href="/" />

      <div className="st-auth-form">
        <header className="st-auth-form__head">
          <h1 className="sc-h1">Create an account.</h1>
          <p className="sc-dek">Set up your client portal to track projects, reports, and messages.</p>
        </header>

        <form onSubmit={handleSubmit} className="st-auth-form__fields">
          <Field id="register-name" label="Full name">
            <Input id="register-name" name="name" type="text" required autoComplete="name" />
          </Field>
          <Field id="register-email" label="Email">
            <Input id="register-email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field id="register-password" label="Password">
            <Input
              id="register-password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
            />
          </Field>
          <Field id="register-confirm" label="Confirm password">
            <Input
              id="register-confirm"
              name="confirm"
              type="password"
              required
              autoComplete="new-password"
            />
          </Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" block loading={loading}>
            {loading ? 'Creating account' : 'Create account'}
          </Button>
        </form>

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
