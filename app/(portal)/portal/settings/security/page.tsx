// app/(portal)/portal/settings/security/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'

type Phase = 'loading' | 'disabled' | 'setup' | 'verify' | 'backup' | 'enabled' | 'disabling'

type SetupData = { secret: string; otpauthUrl: string }

function unwrap(body: unknown): Record<string, unknown> {
  const b = body as { data?: Record<string, unknown> } & Record<string, unknown>
  return (b?.data ?? b) ?? {}
}

export default function SecuritySettingsPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [setup, setSetup] = useState<SetupData | null>(null)
  const [token, setToken] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [backupRemaining, setBackupRemaining] = useState(0)

  const [disableToken, setDisableToken] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/v1/account/2fa/status')
      .then(async (res) => unwrap(await res.json().catch(() => ({}))))
      .then((data) => {
        if (!alive) return
        setBackupRemaining(typeof data.backupCodesRemaining === 'number' ? data.backupCodesRemaining : 0)
        setPhase(data.enabled === true ? 'enabled' : 'disabled')
      })
      .catch(() => { if (alive) setPhase('disabled') })
    return () => { alive = false }
  }, [])

  async function startSetup() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/2fa/setup', { method: 'POST' })
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Failed to start 2FA setup')
      setSetup({ secret: data.secret as string, otpauthUrl: data.otpauthUrl as string })
      setPhase('setup')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start 2FA setup')
    } finally {
      setBusy(false)
    }
  }

  async function verifySetup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Invalid code')
      setBackupCodes(Array.isArray(data.backupCodes) ? (data.backupCodes as string[]) : [])
      setBackupRemaining(Array.isArray(data.backupCodes) ? (data.backupCodes as string[]).length : 0)
      setToken('')
      setPhase('backup')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setBusy(false)
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: disableToken.trim() }),
      })
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Failed to disable 2FA')
      setDisableToken('')
      setSetup(null)
      try { sessionStorage.removeItem('pib_2fa_ok') } catch {}
      setPhase('disabled')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA')
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string) {
    try { navigator.clipboard?.writeText(text) } catch {}
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <p className="eyebrow">Portal settings</p>
        <h1 className="pib-page-title mt-2">Security</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Add an extra layer of protection to your login with two-factor authentication (TOTP).
        </p>
      </div>

      <section data-testid="twofa-panel" className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Two-factor authentication</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Authenticator app (TOTP)</h2>
          </div>
          <span className={`pib-pill shrink-0 ${phase === 'enabled' ? 'pib-pill-success' : ''}`}>
            {phase === 'enabled' ? 'Enabled' : phase === 'loading' ? '…' : 'Disabled'}
          </span>
        </div>

        <div className="p-5">
          {error && <p className="mb-4 text-xs text-red-400" role="alert">{error}</p>}

          {phase === 'loading' && (
            <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
          )}

          {phase === 'disabled' && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                Protect your account by requiring a one-time code from an authenticator app (Google Authenticator, 1Password, Authy) at sign-in.
              </p>
              <button type="button" onClick={startSetup} disabled={busy} className="pib-btn-primary disabled:opacity-60">
                {busy ? 'Starting…' : 'Enable two-factor authentication'}
              </button>
            </div>
          )}

          {phase === 'setup' && setup && (
            <div className="space-y-5">
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                Add this account to your authenticator app, then enter the 6-digit code it shows.
              </p>
              <div className="space-y-3 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
                <div>
                  <p className="pib-label !mb-1">Setup key (paste into your app)</p>
                  <div className="flex items-center gap-2">
                    <code className="break-all rounded-lg bg-black/20 px-3 py-2 font-mono text-sm text-[var(--color-pib-text)]">{setup.secret}</code>
                    <button type="button" onClick={() => copy(setup.secret)} className="pib-pill shrink-0">Copy</button>
                  </div>
                </div>
                <div>
                  <p className="pib-label !mb-1">otpauth URL</p>
                  <div className="flex items-center gap-2">
                    <code className="break-all rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-[var(--color-pib-text-muted)]">{setup.otpauthUrl}</code>
                    <button type="button" onClick={() => copy(setup.otpauthUrl)} className="pib-pill shrink-0">Copy</button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
                    Most authenticator apps let you paste this URL or the setup key directly. No camera needed.
                  </p>
                </div>
              </div>

              <form onSubmit={verifySetup} className="space-y-3">
                <label className="pib-label" htmlFor="twofa-verify-code">Verification code</label>
                <input
                  id="twofa-verify-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="pib-input w-40 text-center text-xl tracking-[0.4em]"
                  autoComplete="one-time-code"
                />
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={busy || token.length !== 6} className="pib-btn-primary disabled:opacity-60">
                    {busy ? 'Verifying…' : 'Verify & enable'}
                  </button>
                  <button type="button" onClick={() => { setSetup(null); setPhase('disabled'); setError('') }} className="text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {phase === 'backup' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-sm font-semibold text-[var(--color-pib-text)]">Two-factor authentication is now enabled.</p>
                <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                  Save these backup codes somewhere safe. Each can be used once if you lose access to your authenticator. They will not be shown again.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4 sm:grid-cols-2">
                {backupCodes.map((code) => (
                  <code key={code} className="rounded-lg bg-black/20 px-3 py-2 text-center font-mono text-sm text-[var(--color-pib-text)]">{code}</code>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => copy(backupCodes.join('\n'))} className="pib-pill">Copy all codes</button>
                <button type="button" onClick={() => setPhase('enabled')} className="pib-btn-primary">
                  I&apos;ve saved my codes
                </button>
              </div>
            </div>
          )}

          {phase === 'enabled' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
                <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">verified_user</span>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-pib-text)]">Two-factor authentication is on</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{backupRemaining} backup code{backupRemaining === 1 ? '' : 's'} remaining.</p>
                </div>
              </div>
              <form onSubmit={disable} className="space-y-3">
                <label className="pib-label" htmlFor="twofa-disable-code">Enter a current code to disable 2FA</label>
                <input
                  id="twofa-disable-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={disableToken}
                  onChange={(e) => setDisableToken(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="pib-input w-40 text-center text-xl tracking-[0.4em]"
                  autoComplete="one-time-code"
                />
                <button
                  type="submit"
                  disabled={busy || disableToken.length !== 6}
                  className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                >
                  {busy ? 'Disabling…' : 'Disable two-factor authentication'}
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      <p className="text-sm text-[var(--color-pib-text-muted)]">
        Manage active sessions on the{' '}
        <a href="/portal/settings/sessions" className="text-[var(--color-pib-accent)] hover:underline">Sessions</a> page.
      </p>
    </div>
  )
}
