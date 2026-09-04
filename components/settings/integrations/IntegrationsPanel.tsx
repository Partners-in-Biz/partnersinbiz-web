'use client'

import { useCallback, useEffect, useState } from 'react'

type Provider = 'github' | 'slack' | 'linear'

type IntegrationRow = {
  provider: Provider
  enabled: boolean
  webhookUrl?: string
  configured: boolean
}

const PROVIDERS: Array<{ id: Provider; label: string; help: string }> = [
  { id: 'github', label: 'GitHub', help: 'Push / pull_request / issues → bot routines' },
  { id: 'slack', label: 'Slack', help: 'Events API + url_verification challenge' },
  { id: 'linear', label: 'Linear', help: 'Issue create/update → bot routines' },
]

/**
 * Org settings panel for inbound integration webhooks that fan out to bot routines.
 * Requires `botRoutinesEnabled`. Outbound posting is out of scope.
 */
export function IntegrationsPanel({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<IntegrationRow[]>(
    PROVIDERS.map((p) => ({ provider: p.id, enabled: false, configured: false })),
  )
  const [secretDraft, setSecretDraft] = useState<Record<Provider, string>>({
    github: '',
    slack: '',
    linear: '',
  })
  const [busy, setBusy] = useState<Provider | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/integrations`)
    if (!res.ok) return
    const body = await res.json().catch(() => null)
    const list = Array.isArray(body?.data?.integrations) ? body.data.integrations : []
    setRows(PROVIDERS.map((p) => {
      const found = list.find((row: { provider?: string }) => row.provider === p.id) as IntegrationRow | undefined
      return found
        ? {
          provider: p.id,
          enabled: Boolean(found.enabled),
          configured: true,
          webhookUrl: found.webhookUrl,
        }
        : { provider: p.id, enabled: false, configured: false }
    }))
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(provider: Provider) {
    const secret = secretDraft[provider].trim()
    if (!secret) {
      setMessage('Paste the signing secret first.')
      return
    }
    setBusy(provider)
    setMessage('')
    try {
      const res = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/integrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, secret, enabled: true }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage(typeof body?.error === 'string' ? body.error : 'Could not save integration.')
        return
      }
      setSecretDraft((prev) => ({ ...prev, [provider]: '' }))
      await load()
      setMessage(`${provider} webhook saved.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section data-testid="integrations-panel" className="space-y-4" aria-label="Integrations">
      <div>
        <h2 className="text-base font-medium text-[var(--color-pib-text)]">Integrations</h2>
        <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
          Inbound webhooks for bot routines. Paste each provider&apos;s signing secret, then copy the webhook URL into that service.
        </p>
      </div>
      {message ? <p className="text-sm text-[var(--color-pib-text-muted)]">{message}</p> : null}
      <ul className="space-y-3">
        {PROVIDERS.map((provider) => {
          const row = rows.find((item) => item.provider === provider.id)!
          return (
            <li
              key={provider.id}
              className="rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{provider.label}</p>
                  <p className="text-[12px] text-[var(--color-pib-text-muted)]">{provider.help}</p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  {row.configured ? (row.enabled ? 'On' : 'Off') : 'Not set'}
                </span>
              </div>
              {row.webhookUrl ? (
                <p className="mt-2 break-all font-mono text-[11px] text-[var(--color-pib-text-muted)]" data-testid={`integration-webhook-${provider.id}`}>
                  {row.webhookUrl}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  aria-label={`${provider.label} signing secret`}
                  placeholder="Signing secret"
                  value={secretDraft[provider.id]}
                  onChange={(event) => setSecretDraft((prev) => ({ ...prev, [provider.id]: event.target.value }))}
                  className="min-h-9 min-w-[12rem] flex-1 rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] px-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy === provider.id}
                  onClick={() => { void save(provider.id) }}
                  className="btn-pib-secondary btn-pib-sm"
                >
                  {busy === provider.id ? 'Saving…' : 'Save'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
