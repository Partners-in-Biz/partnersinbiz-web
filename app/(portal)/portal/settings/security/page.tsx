// app/(portal)/portal/settings/security/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  Field,
  Icon,
  Input,
  Notice,
  Panel,
  Status,
  Title,
  Toolbar,
} from '@/components/studio'

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
      try { sessionStorage.removeItem('pib_2fa_ok') } catch { void 0 }
      setPhase('disabled')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA')
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string) {
    try { navigator.clipboard?.writeText(text) } catch { void 0 }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Security."
        description="Add an extra layer of protection to your login with two-factor authentication (TOTP)."
      />

      <section data-testid="twofa-panel"><Panel className="pib-card-section !p-0 overflow-hidden">
        <Toolbar className="pib-card-section-header border-b border-[var(--sc-line)] px-5 py-4">
          <div>
            <p className="sc-tiny">Two-factor authentication</p>
            <Title className="mt-2">Authenticator app (TOTP)</Title>
          </div>
          <Status tone={phase === 'enabled' ? 'success' : undefined}>
            {phase === 'enabled' ? 'Enabled' : phase === 'loading' ? '…' : 'Disabled'}
          </Status>
        </Toolbar>

        <div className="space-y-4 p-5">
          {error ? <Notice tone="danger">{error}</Notice> : null}

          {phase === 'loading' ? (
            <p className="sc-body text-[var(--sc-ink-soft)]">Loading…</p>
          ) : null}

          {phase === 'disabled' ? (
            <div className="space-y-4">
              <p className="sc-body text-[var(--sc-ink-soft)]">
                Protect your account by requiring a one-time code from an authenticator app (Google Authenticator, 1Password, Authy) at sign-in.
              </p>
              <Button type="button" onClick={startSetup} loading={busy}>
                Enable two-factor authentication
              </Button>
            </div>
          ) : null}

          {phase === 'setup' && setup ? (
            <div className="space-y-5">
              <p className="sc-body text-[var(--sc-ink-soft)]">
                Add this account to your authenticator app, then enter the 6-digit code it shows.
              </p>
              <Panel flat className="space-y-4">
                <div>
                  <p className="sc-tiny mb-1">Setup key (paste into your app)</p>
                  <div className="flex items-center gap-2">
                    <code className="break-all rounded bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] px-3 py-2 font-mono text-sm text-[var(--sc-ink)]">{setup.secret}</code>
                    <Button type="button" variant="ghost" size="sm" onClick={() => copy(setup.secret)}>Copy</Button>
                  </div>
                </div>
                <div>
                  <p className="sc-tiny mb-1">otpauth URL</p>
                  <div className="flex items-center gap-2">
                    <code className="break-all rounded bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] px-3 py-2 font-mono text-xs text-[var(--sc-ink-soft)]">{setup.otpauthUrl}</code>
                    <Button type="button" variant="ghost" size="sm" onClick={() => copy(setup.otpauthUrl)}>Copy</Button>
                  </div>
                  <p className="sc-body mt-2 text-[0.75rem] text-[var(--sc-ink-soft)]">
                    Most authenticator apps let you paste this URL or the setup key directly. No camera needed.
                  </p>
                </div>
              </Panel>

              <form onSubmit={verifySetup} className="space-y-4">
                <Field id="twofa-verify-code" label="Verification code">
                  <Input
                    id="twofa-verify-code"
                    aria-label="Verification code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={token}
                    onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-40 text-center text-xl tracking-[0.4em]"
                    autoComplete="one-time-code"
                  />
                </Field>
                <Toolbar>
                  <Button type="submit" loading={busy} disabled={token.length !== 6}>
                    Verify and enable
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => { setSetup(null); setPhase('disabled'); setError('') }}
                  >
                    Cancel
                  </Button>
                </Toolbar>
              </form>
            </div>
          ) : null}

          {phase === 'backup' ? (
            <div className="space-y-4">
              <Notice tone="warning">
                Two-factor authentication is now enabled. Save these backup codes somewhere safe. Each can be used once if you lose access to your authenticator. They will not be shown again.
              </Notice>
              <Panel flat className="grid grid-cols-2 gap-2">
                {backupCodes.map((code) => (
                  <code key={code} className="rounded bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] px-3 py-2 text-center font-mono text-sm text-[var(--sc-ink)]">{code}</code>
                ))}
              </Panel>
              <Toolbar>
                <Button type="button" variant="secondary" size="sm" onClick={() => copy(backupCodes.join('\n'))}>
                  Copy all codes
                </Button>
                <Button type="button" onClick={() => setPhase('enabled')}>
                  I have saved my codes
                </Button>
              </Toolbar>
            </div>
          ) : null}

          {phase === 'enabled' ? (
            <div className="space-y-5">
              <Panel flat className="flex items-center gap-4">
                <Icon name="verified_user" />
                <div>
                  <p className="text-sm text-[var(--sc-ink)]">Two-factor authentication is on</p>
                  <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">{backupRemaining} backup code{backupRemaining === 1 ? '' : 's'} remaining.</p>
                </div>
              </Panel>
              <form onSubmit={disable} className="space-y-4">
                <Field id="twofa-disable-code" label="Enter a current code to disable 2FA">
                  <Input
                    id="twofa-disable-code"
                    aria-label="Enter a current code to disable 2FA"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={disableToken}
                    onChange={(e) => setDisableToken(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-40 text-center text-xl tracking-[0.4em]"
                    autoComplete="one-time-code"
                  />
                </Field>
                <Button
                  type="submit"
                  variant="danger"
                  loading={busy}
                  disabled={disableToken.length !== 6}
                >
                  Disable two-factor authentication
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      </Panel></section>

      <p className="sc-body text-[var(--sc-ink-soft)]">
        Manage active sessions on the{' '}
        <ButtonLink href="/portal/settings/sessions" variant="ghost" size="sm">Sessions</ButtonLink>
        {' '}page.
      </p>
    </div>
  )
}
