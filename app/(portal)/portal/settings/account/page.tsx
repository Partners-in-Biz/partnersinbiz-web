// app/(portal)/portal/settings/account/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/config'

function SecurityMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
      <p className="text-sm font-semibold text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
      <p className="mt-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">{detail}</p>
    </div>
  )
}

export default function AccountSettingsPage() {
  const auth = getClientAuth()
  const user = auth.currentUser
  const email = user?.email ?? ''
  const emailDisplay = email || 'Email missing'
  const loginStatus = email ? 'Login verified' : 'Login email missing'
  const recoveryStatus = email ? 'Password recovery ready' : 'Recovery blocked'

  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')

  async function handlePasswordReset() {
    if (!email || resetting) return
    setResetting(true)
    setResetError('')
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
    } catch {
      setResetError('Failed to send reset email. Try again.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Account settings</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Keep login ownership and password recovery clear before the team grows around shared CRM work.
          </p>
        </div>
      </div>

      <section role="region" aria-label="Account security command center" className="space-y-4">
        <div className="pib-card space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow !text-[10px]">Access readiness</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Account security command center</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                This is the personal credential layer behind CRM ownership, approvals, billing reviews, and client conversations.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
              Workspace independent
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SecurityMetric
              label="Login email"
              value={loginStatus}
              detail={`${emailDisplay} is the account identity used for portal access and CRM attribution.`}
            />
            <SecurityMetric
              label="Recovery"
              value={recoveryStatus}
              detail={email ? 'Password reset can be triggered without changing workspace data.' : 'Add a login email before password recovery can be sent.'}
            />
            <SecurityMetric
              label="Scope"
              value="Workspace independent"
              detail="Credential changes stay separate from company workspaces, CRM records, and client data."
            />
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="pib-card space-y-3">
          <div>
            <p className="eyebrow !text-[10px]">Login identity</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Login email</h2>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
            <p className="break-all text-sm font-medium text-[var(--color-pib-text)]">{emailDisplay}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
              Read-only. Managed by your account provider so CRM ownership remains tied to a verified identity.
            </p>
          </div>
        </section>

        <section className="pib-card space-y-4">
          <div>
            <p className="eyebrow !text-[10px]">Credential recovery</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Password</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              Send a reset link when account ownership needs to be recovered without changing any CRM workspace settings.
            </p>
          </div>
          {resetSent ? (
            <p className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4 text-sm text-[var(--color-pib-accent)]">
              Password reset email sent to {email}.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={resetting || !email}
                className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-accent)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {resetting ? 'Sending...' : 'Send password reset email'}
              </button>
              {resetError && <p className="text-xs text-red-400 mt-1">{resetError}</p>}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
