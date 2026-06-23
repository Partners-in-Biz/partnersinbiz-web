'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Phase = 'loading' | 'disabled' | 'setup' | 'backup' | 'enabled'
type SetupData = { secret: string; otpauthUrl: string }

function unwrap(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data?: Record<string, unknown> }).data) ?? {}
  }
  return (body as Record<string, unknown>) ?? {}
}

export const dynamic = 'force-dynamic'

export default function AdminTwoFactorPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [token, setToken] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    fetch('/api/v1/account/2fa/status', { cache: 'no-store' })
      .then(async (res) => unwrap(await res.json().catch(() => ({}))))
      .then((data) => {
        if (!cancelled) setPhase(data.enabled === true ? 'enabled' : 'disabled')
      })
      .catch(() => {
        if (!cancelled) setPhase('disabled')
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function beginSetup() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/2fa/setup', { method: 'POST' })
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Could not start setup')
      setSetup({ secret: String(data.secret ?? ''), otpauthUrl: String(data.otpauthUrl ?? '') })
      setPhase('setup')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start setup')
    } finally {
      setBusy(false)
    }
  }

  async function verifySetup(event: React.FormEvent) {
    event.preventDefault()
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
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes.map((code) => String(code)) : [])
      setPhase('backup')
      setToken('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Admin security</p>
        <h1 className="pib-page-title mt-2">Two-factor authentication</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Platform admins are expected to keep TOTP enabled. This page lets you set up the authenticator flow used by the admin challenge gate.
        </p>
      </header>

      <section className="pib-card p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Current state</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Authenticator app (TOTP)</h2>
          </div>
          <span className={`pib-pill ${phase === 'enabled' ? 'pib-pill-success' : phase === 'loading' ? '' : 'pib-pill-warn'}`}>
            {phase === 'enabled' ? 'Enabled' : phase === 'loading' ? 'Loading' : 'Required'}
          </span>
        </div>

        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div> : null}

        {phase === 'loading' ? <p className="text-sm text-on-surface-variant">Checking your 2FA status...</p> : null}

        {phase === 'disabled' ? (
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant">
              Enable two-factor authentication before using the operator control plane from a fresh browser session.
            </p>
            <button type="button" onClick={beginSetup} disabled={busy} className="pib-btn-primary disabled:opacity-60">
              {busy ? 'Starting...' : 'Enable two-factor authentication'}
            </button>
          </div>
        ) : null}

        {phase === 'setup' && setup ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
              <p className="pib-label !mb-1">Setup key</p>
              <code className="block break-all rounded-lg bg-black/20 px-3 py-2 font-mono text-sm text-[var(--color-pib-text)]">{setup.secret}</code>
              <p className="mt-3 pib-label !mb-1">otpauth URL</p>
              <code className="block break-all rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-[var(--color-pib-text-muted)]">{setup.otpauthUrl}</code>
            </div>

            <form onSubmit={verifySetup} className="space-y-3">
              <label className="pib-label" htmlFor="admin-twofa-code">Verification code</label>
              <input
                id="admin-twofa-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={token}
                onChange={(event) => setToken(event.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="pib-input w-40 text-center text-xl tracking-[0.4em]"
              />
              <button type="submit" disabled={busy || token.length !== 6} className="pib-btn-primary disabled:opacity-60">
                {busy ? 'Verifying...' : 'Verify and enable'}
              </button>
            </form>
          </div>
        ) : null}

        {phase === 'backup' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-on-surface">
              Save these backup codes now. They are returned once when Two-factor authentication is first enabled.
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {backupCodes.map((code) => (
                <code key={code} className="rounded-lg bg-black/20 px-3 py-2 text-center font-mono text-sm text-on-surface">
                  {code}
                </code>
              ))}
            </div>
            <button type="button" onClick={() => setPhase('enabled')} className="pib-btn-primary">
              I saved the backup codes
            </button>
          </div>
        ) : null}

        {phase === 'enabled' ? (
          <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <p className="text-sm font-semibold text-on-surface">Two-factor authentication is enabled.</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              The admin challenge gate will prompt for a code in new browser sessions when the session flag is not yet satisfied.
            </p>
          </div>
        ) : null}
      </section>

      <div className="pib-card p-5 text-sm text-on-surface-variant">
        After setup, continue back to <Link href="/admin/dashboard" className="text-[var(--color-pib-accent)] hover:underline">/admin/dashboard</Link>.
      </div>
    </div>
  )
}
