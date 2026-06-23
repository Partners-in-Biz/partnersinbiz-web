'use client'

// TwoFactorGate — OPTIONAL post-login 2FA challenge.
//
// Mount this at the top of the portal layout's main content. When it mounts it
// checks whether the signed-in user has 2FA enabled and whether THIS browser
// session has already satisfied the challenge (tracked via sessionStorage flag
// `pib_2fa_ok`). If 2FA is enabled and not yet satisfied, it renders a
// full-screen TOTP prompt that calls /api/v1/account/2fa/challenge. On success
// it sets the flag and unmounts the overlay.
//
// It does NOT touch the login/session-creation flow. It is purely additive:
// if 2FA is disabled, or the flag is set, it renders nothing.
//
// MOUNT (one line, in the orchestrator-owned PortalLayoutClient):
//   <TwoFactorGate /> at the top of the main content region.

import { useEffect, useState } from 'react'

const FLAG_KEY = 'pib_2fa_ok'
const STATUS_ENDPOINT = '/api/v1/account/2fa/status'
const CHALLENGE_ENDPOINT = '/api/v1/account/2fa/challenge'

type Phase = 'checking' | 'required' | 'satisfied'

export function TwoFactorGate() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [token, setToken] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true

    // Already satisfied this session — skip entirely.
    if (typeof window !== 'undefined' && sessionStorage.getItem(FLAG_KEY) === '1') {
      setPhase('satisfied')
      return
    }

    fetch(STATUS_ENDPOINT)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        return body?.data ?? body
      })
      .then((data) => {
        if (!alive) return
        if (data?.enabled === true) {
          setPhase('required')
        } else {
          // 2FA disabled — nothing to do, mark satisfied to avoid re-checks.
          try { sessionStorage.setItem(FLAG_KEY, '1') } catch {}
          setPhase('satisfied')
        }
      })
      .catch(() => {
        // On error (e.g. not authenticated yet) do not block the UI.
        if (alive) setPhase('satisfied')
      })

    return () => { alive = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const payload = useBackup ? { backupCode: backupCode.trim() } : { token: token.trim() }
      const res = await fetch(CHALLENGE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Verification failed')
      try { sessionStorage.setItem(FLAG_KEY, '1') } catch {}
      setPhase('satisfied')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase !== 'required') return null

  return (
    <div
      data-testid="two-factor-gate"
      role="dialog"
      aria-modal="true"
      aria-label="Two-factor authentication required"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="pib-card w-full max-w-md space-y-5">
        <div className="space-y-2 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">shield_lock</span>
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Two-factor authentication</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            {useBackup
              ? 'Enter one of your backup codes to continue.'
              : 'Enter the 6-digit code from your authenticator app to continue.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {useBackup ? (
            <input
              type="text"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
              placeholder="xxxx-xxxx-xx"
              autoComplete="one-time-code"
              className="pib-input w-full text-center tracking-widest"
              aria-label="Backup code"
            />
          ) : (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
              className="pib-input w-full text-center text-2xl tracking-[0.5em]"
              aria-label="Authentication code"
            />
          )}

          {error && <p className="text-xs text-red-400" role="alert">{error}</p>}

          <button
            type="submit"
            disabled={submitting || (useBackup ? !backupCode.trim() : token.length !== 6)}
            className="pib-btn-primary w-full justify-center disabled:opacity-60"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>

          <button
            type="button"
            onClick={() => { setUseBackup((v) => !v); setError(''); setToken(''); setBackupCode('') }}
            className="w-full text-center text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
          >
            {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default TwoFactorGate
