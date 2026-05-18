'use client'
//
// TikTok Ads connection panel — separate component from `ConnectionsPanel`
// (which owns Meta), `GoogleConnectionsPanel`, and `LinkedinConnectionsPanel`
// so each provider can evolve independently. Rendered alongside the other
// panels on `app/(admin)/admin/org/[slug]/ads/connections/page.tsx`.
//
// Flow:
//   - No connection → "Connect TikTok Ads" button → POST authorize → redirect
//   - Connection without selectedAdvertiserId → fetch advertisers
//     (`GET /api/v1/ads/tiktok/accounts`) → render <select> picker →
//     submit PATCHes `selectedAdvertiserId` then router.refresh()
//   - Connection with selectedAdvertiserId → status pill + disconnect button
//
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdConnection } from '@/lib/ads/types'

interface Props {
  orgSlug: string
  orgId: string
  connections: AdConnection[]
}

interface TiktokAdvertiserSummary {
  advertiserId: string
  advertiserName?: string
  currency?: string
}

function getSelectedAdvertiserId(conn: AdConnection | undefined): string | undefined {
  if (!conn) return undefined
  const meta = (conn.meta ?? {}) as Record<string, unknown>
  const tiktok = (meta.tiktok as Record<string, unknown> | undefined) ?? {}
  const v = tiktok.selectedAdvertiserId
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function TiktokConnectionsPanel({ orgSlug, orgId, connections }: Props) {
  const router = useRouter()
  const tiktok = connections.find((c) => c.platform === 'tiktok')
  const selectedAdvertiserId = getSelectedAdvertiserId(tiktok)

  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [accounts, setAccounts] = useState<TiktokAdvertiserSummary[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const needsAccountPicker = !!tiktok && !selectedAdvertiserId

  // Load advertiser accounts when we have a connection but no chosen advertiser yet.
  useEffect(() => {
    if (!needsAccountPicker || !tiktok) return
    let cancelled = false
    setAccountsLoading(true)
    setAccountsError(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/v1/ads/tiktok/accounts?connectionId=${encodeURIComponent(tiktok.id)}`,
          { headers: { 'X-Org-Id': orgId } },
        )
        const body = await res.json()
        if (cancelled) return
        if (!body.success) {
          setAccountsError(body.error ?? `HTTP ${res.status}`)
          setAccounts([])
        } else {
          const list = (body.data?.accounts ?? []) as TiktokAdvertiserSummary[]
          setAccounts(list)
          if (list.length > 0) setSelected(list[0].advertiserId)
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
  }, [needsAccountPicker, tiktok, orgId])

  async function startConnect() {
    setConnecting(true)
    try {
      const res = await fetch('/api/v1/ads/tiktok/oauth/authorize', {
        method: 'POST',
        headers: { 'X-Org-Id': orgId, 'X-Org-Slug': orgSlug },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Authorize failed')
      window.location.href = body.data.authorizeUrl
    } catch (err) {
      setConnecting(false)
      alert((err as Error).message)
    }
  }

  async function saveAdvertiser() {
    if (!tiktok || !selected) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/v1/ads/tiktok/connections/${encodeURIComponent(tiktok.id)}/account`,
        {
          method: 'PATCH',
          headers: {
            'X-Org-Id': orgId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ selectedAdvertiserId: selected }),
        },
      )
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!tiktok) return
    if (!confirm('Disconnect TikTok Ads? This revokes ad account access.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/v1/ads/connections/tiktok', {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="rounded-lg border border-white/10 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">TikTok Ads</h2>
          <p className="text-xs text-white/50">
            {tiktok
              ? selectedAdvertiserId
                ? `Connected · Advertiser ${selectedAdvertiserId}`
                : 'Connected · pick an Advertiser below'
              : 'Not connected'}
          </p>
        </div>
        {tiktok ? (
          <button
            className="btn-pib-ghost text-sm"
            onClick={disconnect}
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
            {connecting ? 'Redirecting…' : 'Connect TikTok Ads'}
          </button>
        )}
      </div>

      {tiktok && selectedAdvertiserId && (
        <div className="mt-4">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-300">
            Advertiser {selectedAdvertiserId}
          </span>
        </div>
      )}

      {needsAccountPicker && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-medium">Select Advertiser</h3>
          {accountsLoading && (
            <p className="text-xs text-white/40">Loading advertisers…</p>
          )}
          {accountsError && (
            <p className="text-xs text-red-300">
              Could not load advertisers: {accountsError}
            </p>
          )}
          {!accountsLoading && !accountsError && accounts.length === 0 && (
            <p className="text-xs text-white/40">
              No advertisers found. Confirm your TikTok account has access to a
              TikTok For Business Marketing API ad account.
            </p>
          )}
          {accounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Select Advertiser"
                className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={saving}
              >
                {accounts.map((a) => (
                  <option key={a.advertiserId} value={a.advertiserId}>
                    {a.advertiserName
                      ? `${a.advertiserName} (${a.advertiserId})`
                      : `Advertiser ${a.advertiserId}`}
                  </option>
                ))}
              </select>
              <button
                className="btn-pib-accent text-sm"
                onClick={saveAdvertiser}
                disabled={saving || !selected}
              >
                {saving ? 'Saving…' : 'Use this advertiser'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
