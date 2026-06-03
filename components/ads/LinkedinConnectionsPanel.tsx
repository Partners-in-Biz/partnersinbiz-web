'use client'
//
// LinkedIn Ads connection panel — separate component from `ConnectionsPanel`
// (which owns Meta) and `GoogleConnectionsPanel` so each provider can evolve
// independently and the Meta/Google paths stay untouched. Rendered alongside
// `ConnectionsPanel` and `GoogleConnectionsPanel` on
// `app/(admin)/admin/org/[slug]/ads/connections/page.tsx`.
//
// Flow:
//   - No connection → "Connect LinkedIn Ads" button → POST authorize → redirect
//   - Connection without selectedAdAccountUrn → fetch ad accounts
//     (`GET /api/v1/ads/linkedin/accounts`) → render <select> picker →
//     submit PATCHes `selectedAdAccountUrn` then router.refresh()
//   - Connection with selectedAdAccountUrn → status pill + disconnect button
//
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdConnection } from '@/lib/ads/types'

interface Props {
  orgSlug: string
  orgId: string
  connections: AdConnection[]
}

interface LinkedinAccountSummary {
  urn: string
  name?: string
  currency?: string
}

function getSelectedAdAccountUrn(conn: AdConnection | undefined): string | undefined {
  if (!conn) return undefined
  const meta = (conn.meta ?? {}) as Record<string, unknown>
  const linkedin = (meta.linkedin as Record<string, unknown> | undefined) ?? {}
  const v = linkedin.selectedAdAccountUrn
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Extract numeric ID from urn:li:sponsoredAccount:{id} for display brevity. */
function displayUrn(urn: string): string {
  const match = /^urn:li:sponsoredAccount:(\d+)$/.exec(urn)
  return match ? `Account ${match[1]}` : urn
}

export function LinkedinConnectionsPanel({ orgSlug, orgId, connections }: Props) {
  const router = useRouter()
  const [linkedinDisconnected, setLinkedinDisconnected] = useState(false)
  const linkedin = linkedinDisconnected ? undefined : connections.find((c) => c.platform === 'linkedin')
  const selectedAdAccountUrn = getSelectedAdAccountUrn(linkedin)

  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<LinkedinAccountSummary[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const needsAccountPicker = !!linkedin && !selectedAdAccountUrn

  // Load ad accounts when we have a connection but no chosen URN yet.
  useEffect(() => {
    if (!needsAccountPicker || !linkedin) return
    let cancelled = false
    setAccountsLoading(true)
    setAccountsError(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/v1/ads/linkedin/accounts?connectionId=${encodeURIComponent(linkedin.id)}`,
          { headers: { 'X-Org-Id': orgId } },
        )
        const body = await res.json()
        if (cancelled) return
        if (!body.success) {
          setAccountsError(body.error ?? `HTTP ${res.status}`)
          setAccounts([])
        } else {
          const list = (body.data?.accounts ?? []) as LinkedinAccountSummary[]
          setAccounts(list)
          if (list.length > 0) setSelected(list[0].urn)
        }
      } catch (err) {
        if (!cancelled) setAccountsError((err as Error).message)
      } finally {
        if (!cancelled) setAccountsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needsAccountPicker, linkedin, orgId])

  async function startConnect() {
    setConnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/linkedin/oauth/authorize', {
        method: 'POST',
        headers: { 'X-Org-Id': orgId, 'X-Org-Slug': orgSlug },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Authorize failed')
      window.location.href = body.data.authorizeUrl
    } catch (err) {
      setConnecting(false)
      setActionError((err as Error).message)
    }
  }

  async function saveAdAccount() {
    if (!linkedin || !selected) return
    setSaving(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/v1/ads/linkedin/connections/${encodeURIComponent(linkedin.id)}/account`,
        {
          method: 'PATCH',
          headers: {
            'X-Org-Id': orgId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ selectedAdAccountUrn: selected }),
        },
      )
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setMessage('LinkedIn Ads account updated.')
      router.refresh()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function requestDisconnect() {
    setActionError(null)
    setMessage(null)
    setConfirmDisconnect(true)
  }

  async function disconnect() {
    if (!linkedin) return
    setDisconnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/connections/linkedin', {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setConfirmDisconnect(false)
      setLinkedinDisconnected(true)
      setMessage('LinkedIn Ads disconnected.')
      router.refresh()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="rounded-lg border border-white/10 p-5">
      {confirmDisconnect && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Disconnect LinkedIn Ads connection for ${orgSlug}?`}
          className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-red-100">Disconnect LinkedIn Ads connection?</h2>
              <p className="mt-1 text-sm text-red-100/80">
                This revokes LinkedIn Marketing API ad account access for this workspace. Campaign history stays in PiB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-red-100/30 px-3 py-2 text-xs font-medium text-red-50 hover:bg-red-50/10 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setConfirmDisconnect(false)}
                disabled={disconnecting}
              >
                Keep LinkedIn Ads connected
              </button>
              <button
                type="button"
                className="rounded-md bg-red-300 px-3 py-2 text-xs font-medium text-red-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : `Confirm disconnect LinkedIn Ads connection for ${orgSlug}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {(message || actionError) && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            actionError
              ? 'border-red-400/30 bg-red-400/10 text-red-200'
              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          }`}
        >
          {actionError ?? message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">LinkedIn Ads</h2>
          <p className="text-xs text-white/50">
            {linkedin
              ? selectedAdAccountUrn
                ? `Connected · ${displayUrn(selectedAdAccountUrn)}`
                : 'Connected · pick an Ad Account below'
              : 'Not connected'}
          </p>
        </div>
        {linkedin ? (
          <button
            className="btn-pib-ghost text-sm"
            aria-label={`Disconnect LinkedIn Ads connection for ${orgSlug}`}
            onClick={requestDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            className="btn-pib-accent text-sm"
            onClick={startConnect}
            disabled={connecting}
          >
            {connecting ? 'Redirecting…' : 'Connect LinkedIn Ads'}
          </button>
        )}
      </div>

      {linkedin && selectedAdAccountUrn && (
        <div className="mt-4">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-300">
            {displayUrn(selectedAdAccountUrn)}
          </span>
        </div>
      )}

      {needsAccountPicker && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-medium">Select Ad Account</h3>
          {accountsLoading && (
            <p className="text-xs text-white/40">Loading ad accounts…</p>
          )}
          {accountsError && (
            <p className="text-xs text-red-300">
              Could not load ad accounts: {accountsError}
            </p>
          )}
          {!accountsLoading && !accountsError && accounts.length === 0 && (
            <p className="text-xs text-white/40">
              No ad accounts found. Confirm your LinkedIn account has access to a
              LinkedIn Marketing API ad account.
            </p>
          )}
          {accounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Select Ad Account"
                className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={saving}
              >
                {accounts.map((a) => (
                  <option key={a.urn} value={a.urn}>
                    {a.name ? `${a.name} (${displayUrn(a.urn)})` : displayUrn(a.urn)}
                  </option>
                ))}
              </select>
              <button
                className="btn-pib-accent text-sm"
                onClick={saveAdAccount}
                disabled={saving || !selected}
              >
                {saving ? 'Saving…' : 'Use this account'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
