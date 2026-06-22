// app/(portal)/portal/settings/account/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { sendPasswordResetEmail, deleteUser } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/config'

function SecurityRow({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
  testId,
}: {
  icon: string
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'success' | 'warn'
  testId: string
}) {
  const pillClass = tone === 'success'
    ? 'pib-pill pib-pill-success'
    : tone === 'warn'
      ? 'pib-pill pib-pill-warn'
      : 'pib-pill'

  return (
    <div data-testid={testId} className="pib-card-section-row gap-4 max-sm:flex-col max-sm:items-start">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="material-symbols-outlined mt-0.5 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="pib-label !mb-0">{label}</p>
          <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]" title={value}>{value}</p>
          <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">{detail}</p>
        </div>
      </div>
      <span className={`${pillClass} shrink-0`}>{tone === 'success' ? 'Ready' : tone === 'warn' ? 'Needs email' : 'Separate'}</span>
    </div>
  )
}

export default function AccountSettingsPage() {
  const auth = getClientAuth()
  const user = auth.currentUser
  const email = user?.email ?? ''
  const emailDisplay = email || 'Email missing'
  const recoveryStatus = email ? 'Password recovery ready' : 'Recovery blocked'

  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function handleDeleteAccount() {
    if (deleteConfirmText !== 'DELETE' || deleting || !user) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteUser(user)
      // Firebase signs the user out automatically on delete
      window.location.href = '/login'
    } catch {
      setDeleteError('Could not delete account. Please sign out and sign back in first, then try again.')
      setDeleting(false)
    }
  }

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
          <p className="eyebrow">Portal settings</p>
          <h1 className="pib-page-title mt-2">Account settings</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Manage your login identity and password recovery without changing workspace, CRM, or client data.
          </p>
        </div>
      </div>

      <section role="region" aria-label="Account access overview" className="pib-card-section">
        <div className="pib-card-section-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow !text-[10px]">Access readiness</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Account access overview</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
              Personal login details stay separate from workspace, CRM, and client data.
            </p>
          </div>
          <span className="pib-pill shrink-0">Workspace independent</span>
        </div>

        <SecurityRow
          icon="alternate_email"
          testId="account-readiness-login-email"
          label="Login email"
          value={emailDisplay}
          detail={email ? 'This verified identity is used for portal access and CRM attribution.' : 'Add a login email before account recovery can be sent.'}
          tone={email ? 'success' : 'warn'}
        />
        <SecurityRow
          icon="lock_reset"
          testId="account-readiness-recovery"
          label="Recovery"
          value={recoveryStatus}
          detail={email ? 'Password reset can be triggered without changing workspace data.' : 'Recovery is blocked until the account has a login email.'}
          tone={email ? 'success' : 'warn'}
        />
        <SecurityRow
          icon="domain_disabled"
          testId="account-readiness-scope"
          label="Scope"
          value="Workspace independent"
          detail="Credential changes do not edit company workspaces, CRM records, or client-facing data."
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section data-testid="account-login-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Login identity</p>
          </div>
          <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
            <span className="material-symbols-outlined rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">person</span>
            <div className="min-w-0 flex-1 space-y-2">
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Login email</h2>
              <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]" title={emailDisplay}>{emailDisplay}</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Read-only. Managed by your account provider so CRM ownership remains tied to a verified identity.
              </p>
            </div>
          </div>
        </section>

        <section data-testid="account-password-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Credential recovery</p>
          </div>
          <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
            <span className="material-symbols-outlined rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">key</span>
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Password</h2>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  Send a reset link when account ownership needs to be recovered without changing CRM workspace settings.
                </p>
              </div>
              {resetSent ? (
                <p className="pib-pill pib-pill-success w-fit" role="status">
                  Password reset email sent to {email}.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={resetting || !email}
                    className="pib-btn-primary w-full justify-center disabled:opacity-60 sm:w-auto"
                  >
                    {resetting ? 'Sending...' : 'Send password reset email'}
                  </button>
                  {resetError && <p className="text-xs text-red-400 mt-1" role="alert">{resetError}</p>}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <section data-testid="account-danger-zone" className="pib-card-section border-red-500/20">
        <div className="pib-card-section-header">
          <p className="text-[10px] font-label uppercase tracking-widest text-red-400">Danger zone</p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Delete account</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Permanently deletes your login identity. Your organisation's CRM data, documents, and workspace remain intact — only your personal login is removed. This cannot be undone.
          </p>
        </div>

        <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
          <span className="material-symbols-outlined rounded-xl border border-red-500/20 bg-red-500/5 p-2 text-[20px] text-red-400 shrink-0" aria-hidden="true">person_remove</span>
          <div className="min-w-0 flex-1 space-y-4">
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Delete my account
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[var(--color-pib-text-muted)]">
                  Type <strong className="text-[var(--color-pib-text)] font-mono">DELETE</strong> to confirm permanent removal.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  className="rounded-lg border border-red-500/30 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-red-500/50 w-full max-w-xs"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || deleting}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
                  >
                    {deleting ? 'Deleting…' : 'Permanently delete account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError('') }}
                    className="text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
                  >
                    Cancel
                  </button>
                </div>
                {deleteError && <p className="text-xs text-red-400" role="alert">{deleteError}</p>}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
