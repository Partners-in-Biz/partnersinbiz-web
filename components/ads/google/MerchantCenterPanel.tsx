'use client'
// components/ads/google/MerchantCenterPanel.tsx
// Panel to connect + manage Google Merchant Center bindings.
// Sub-3a Phase 4 Batch 2 Agent D.

import { useEffect, useState } from 'react'
import type { AdMerchantCenter } from '@/lib/ads/types'

interface Props {
  orgSlug: string
  orgId: string
}

export function MerchantCenterPanel({ orgSlug, orgId }: Props) {
  const [bindings, setBindings] = useState<AdMerchantCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    id: string
    merchantId: string
  } | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/ads/google/merchant-center', {
          headers: { 'X-Org-Id': orgId },
        })
        const body = await res.json()
        if (cancelled) return
        if (!body.success) {
          setError(body.error ?? `HTTP ${res.status}`)
          setBindings([])
        } else {
          setBindings((body.data?.bindings ?? []) as AdMerchantCenter[])
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function startConnect() {
    setConnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/google/merchant-center/oauth/authorize', {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Authorize failed')
      window.location.href = body.data.authorizeUrl
    } catch (err) {
      setConnecting(false)
      setActionError((err as Error).message)
    }
  }

  async function updateFeedLabel(id: string, primaryFeedLabel: string) {
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/ads/google/merchant-center/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'X-Org-Id': orgId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryFeedLabel }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      // Update local state
      setBindings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, primaryFeedLabel } : b)),
      )
      setMessage('Merchant Center feed label updated.')
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  function requestDisconnect(id: string, merchantId: string) {
    setActionError(null)
    setMessage(null)
    setConfirmDisconnect({ id, merchantId })
  }

  async function disconnect(id: string, merchantId: string) {
    setDisconnectingId(id)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/ads/google/merchant-center/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setConfirmDisconnect(null)
      setBindings((prev) => prev.filter((b) => b.id !== id))
      setMessage(`Merchant Center account ${merchantId} disconnected.`)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setDisconnectingId(null)
    }
  }

  return (
    <div className="rounded-lg border border-white/10 p-5 space-y-4">
      {confirmDisconnect && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Disconnect Merchant Center account ${confirmDisconnect.merchantId} for ${orgSlug}?`}
          className="rounded-lg border border-red-400/30 bg-red-400/10 p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-red-100">Disconnect Merchant Center account?</h2>
              <p className="mt-1 text-sm text-red-100/80">
                Shopping campaigns using this Merchant Center account will stop syncing. Campaign history stays in PiB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-red-100/30 px-3 py-2 text-xs font-medium text-red-50 hover:bg-red-50/10 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setConfirmDisconnect(null)}
                disabled={disconnectingId === confirmDisconnect.id}
              >
                Keep Merchant Center connected
              </button>
              <button
                type="button"
                className="rounded-md bg-red-300 px-3 py-2 text-xs font-medium text-red-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => disconnect(confirmDisconnect.id, confirmDisconnect.merchantId)}
                disabled={disconnectingId === confirmDisconnect.id}
              >
                {disconnectingId === confirmDisconnect.id
                  ? 'Disconnecting...'
                  : `Confirm disconnect Merchant Center account ${confirmDisconnect.merchantId} for ${orgSlug}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {(message || actionError) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionError
              ? 'border-red-400/30 bg-red-400/10 text-red-200'
              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          }`}
        >
          {actionError ?? message}
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Google Merchant Center</h2>
          <p className="text-xs text-white/50">
            {loading
              ? 'Loading…'
              : bindings.length === 0
                ? 'No accounts connected'
                : `${bindings.length} account${bindings.length > 1 ? 's' : ''} connected`}
          </p>
        </div>
        {!loading && bindings.length === 0 && (
          <button
            className="btn-pib-accent text-sm"
            onClick={startConnect}
            disabled={connecting}
            aria-label="Connect Merchant Center"
          >
            {connecting ? 'Redirecting…' : 'Connect Merchant Center'}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-300 rounded border border-red-500/30 bg-red-500/10 px-3 py-2">
          {error}
        </p>
      )}

      {/* Bindings list */}
      {bindings.map((binding) => {
        const feedLabel = (binding as AdMerchantCenter & { primaryFeedLabel?: string }).primaryFeedLabel ?? ''
        return (
          <div
            key={binding.id}
            className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-3"
            aria-label={`Merchant Center binding ${binding.merchantId}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">Merchant ID: {binding.merchantId}</span>
              </div>
              <button
                className="btn-pib-ghost text-sm"
                onClick={() => requestDisconnect(binding.id, binding.merchantId)}
                aria-label={`Disconnect Merchant Center account ${binding.merchantId} for ${orgSlug}`}
                disabled={disconnectingId === binding.id}
              >
                {disconnectingId === binding.id ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>

            {/* Feed label picker */}
            {binding.feedLabels && binding.feedLabels.length > 0 && (
              <div>
                <label className="block text-xs text-white/60 mb-1">
                  Primary feed label
                </label>
                <select
                  className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white w-full max-w-xs"
                  value={feedLabel}
                  onChange={(e) => updateFeedLabel(binding.id, e.target.value)}
                  aria-label={`Feed label for ${binding.merchantId}`}
                >
                  <option value="">— select feed label —</option>
                  {binding.feedLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {binding.feedLabels && binding.feedLabels.length === 0 && (
              <p className="text-xs text-white/40">No feed labels available for this account.</p>
            )}
          </div>
        )
      })}

      {/* Add another account (when at least one exists) */}
      {!loading && bindings.length > 0 && (
        <button
          className="btn-pib-ghost text-sm"
          onClick={startConnect}
          disabled={connecting}
          aria-label="Connect another Merchant Center account"
        >
          {connecting ? 'Redirecting…' : '+ Connect another account'}
        </button>
      )}
    </div>
  )
}
