'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Icon } from '@/components/studio'

interface DataSummary {
  orgMemberships: number
  ownedOrgs: number
  notifications: number
  apiKeys: number
  hasUserDoc: boolean
}

type Step = 'review' | 'confirm' | 'final' | 'scheduled'

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data: T }).data) ?? null
  }
  return (body as T) ?? null
}

/**
 * Hardened multi-step account deletion flow.
 * Step 1: review what gets deleted (live counts).
 * Step 2: type DELETE to confirm.
 * Step 3: final confirm -> POST /api/v1/account/delete.
 * Success: 30-day recovery window explainer + cancel option.
 *
 * Integration: replace the inline Danger Zone delete on the account page with
 *   <AccountDeletionFlow />
 */
export function AccountDeletionFlow() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('review')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<DataSummary | null>(null)
  const [typed, setTyped] = useState('')
  const [recoveryDays, setRecoveryDays] = useState(30)
  const [cancelled, setCancelled] = useState(false)

  function goToConfirm() {
    setError('')
    setStep('confirm')
  }

  async function schedule() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/delete', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setError((body?.error as string) || 'Failed to schedule deletion')
        return
      }
      const data = unwrap<{ dataSummary: DataSummary; recoveryWindowDays: number }>(body)
      if (data?.dataSummary) setSummary(data.dataSummary)
      if (data?.recoveryWindowDays) setRecoveryDays(data.recoveryWindowDays)
      setStep('scheduled')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function cancelDeletion() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/delete/cancel', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setError((body?.error as string) || 'Failed to cancel deletion')
        return
      }
      setCancelled(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const itemClass = 'flex items-center gap-2 text-sm text-[var(--color-pib-text-muted)]'

  return (
    <div className="pib-card border border-red-500/30 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Icon name="warning" className="text-[var(--st-danger)]" />
        <h3 className="text-base font-medium text-[var(--color-pib-text)]">Delete account</h3>
      </div>

      {error && (
        <p className="text-sm text-[var(--st-danger)] bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Deleting your account will permanently remove the following after a
            30-day recovery window:
          </p>
          <ul className="space-y-1.5">
            <li className={itemClass}><Icon name="person" className="text-[16px]" /> Your profile &amp; sign-in</li>
            <li className={itemClass}><Icon name="groups" className="text-[16px]" /> Your workspace memberships</li>
            <li className={itemClass}><Icon name="notifications" className="text-[16px]" /> Notifications &amp; preferences</li>
            <li className={itemClass}><Icon name="key" className="text-[16px]" /> Personal API keys</li>
            <li className={itemClass}><Icon name="image" className="text-[16px]" /> Avatar &amp; uploaded media</li>
          </ul>
          <button
            type="button"
            onClick={goToConfirm}
            disabled={loading}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-red-500/15 text-[var(--st-danger)] hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Type <span className="font-mono font-medium text-[var(--color-pib-text)]">DELETE</span> to confirm you want to delete your account.
          </p>
          <input aria-label="DELETE"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-red-500/50"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep('review')}
              className="text-sm px-4 py-2 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
            >
              Back
            </button>
            <button
              type="button"
              disabled={typed.trim() !== 'DELETE'}
              onClick={() => setStep('final')}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-red-500/15 text-[var(--st-danger)] hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'final' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-pib-text)]">
            This schedules permanent deletion of your account. You will have
            <strong> 30 days</strong> to cancel before your data is purged.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep('confirm')}
              className="text-sm px-4 py-2 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
            >
              Back
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={schedule}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Scheduling…' : 'Delete my account'}
            </button>
          </div>
        </div>
      )}

      {step === 'scheduled' && (
        <div className="space-y-4">
          {cancelled ? (
            <>
              <div className="flex items-center gap-2 text-green-400">
                <Icon name="check_circle" />
                <p className="text-sm font-medium">Deletion cancelled. Your account is safe.</p>
              </div>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="text-sm px-4 py-2 rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[var(--color-pib-text)]">
                <Icon name="schedule" className="text-[var(--st-warning)]" />
                <p className="text-sm font-medium">Account scheduled for deletion</p>
              </div>
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                Your account and data will be permanently deleted in {recoveryDays} days.
                You can cancel any time before then to keep your account.
              </p>
              {summary && (
                <ul className="text-xs text-[var(--color-pib-text-muted)] space-y-1">
                  <li>{summary.orgMemberships} workspace membership(s)</li>
                  <li>{summary.ownedOrgs} owned organisation(s)</li>
                  <li>{summary.notifications} notification(s)</li>
                  <li>{summary.apiKeys} API key(s)</li>
                </ul>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={cancelDeletion}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? 'Cancelling…' : 'Cancel deletion'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
