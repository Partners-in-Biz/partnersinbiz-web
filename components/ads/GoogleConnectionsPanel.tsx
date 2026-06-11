'use client'
//
// Google Ads connection panel — separate component from `ConnectionsPanel`
// (which owns Meta) so the two providers can evolve independently and the
// Meta paths stay untouched. Rendered alongside `ConnectionsPanel` on
// `app/(admin)/admin/org/[slug]/ads/connections/page.tsx`.
//
// Flow:
//   - No connection → "Connect Google Ads" button → POST authorize → redirect
//   - Connection without defaultAdAccountId → fetch accessible customers
//     (`GET /api/v1/ads/google/customers`) → render <select> picker →
//     submit PATCHes `customerId` then router.refresh()
//   - Connection with defaultAdAccountId → status pill + disconnect button
//
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { AdConnection } from '@/lib/ads/types'

interface Props {
  orgSlug: string
  orgId: string
  connections: AdConnection[]
}

interface CustomerSummary {
  customerId: string
  resourceName: string
}

function getLoginCustomerId(conn: AdConnection | undefined): string | undefined {
  if (!conn) return undefined
  const meta = (conn.meta ?? {}) as Record<string, unknown>
  const google = (meta.google as Record<string, unknown> | undefined) ?? {}
  const v = google.loginCustomerId
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function getCustomerId(conn: AdConnection | undefined): string | undefined {
  const v = conn?.defaultAdAccountId
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function GoogleConnectionsPanel({ orgSlug, orgId, connections }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackStatus = searchParams.get('status')
  const callbackProvider = searchParams.get('provider')
  const callbackMessage = searchParams.get('message')
  const needsAccountSelection = searchParams.get('needsAccountSelection') === '1'
  const isGoogleCallback = callbackProvider === 'google'
  const callbackNotice = isGoogleCallback
    ? callbackStatus === 'connected' && needsAccountSelection
      ? 'Google Ads connected. Select a Customer ID to finish account setup.'
      : callbackStatus === 'error'
        ? `Google Ads connection failed: ${callbackMessage ?? 'unknown_error'}`
        : null
    : null
  const [googleDisconnected, setGoogleDisconnected] = useState(false)
  const google = googleDisconnected ? undefined : connections.find((c) => c.platform === 'google')
  const loginCustomerId = getLoginCustomerId(google)
  const customerId = getCustomerId(google)

  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customersError, setCustomersError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [managerCustomerId, setManagerCustomerId] = useState(loginCustomerId ?? '')
  const [saving, setSaving] = useState(false)

  const needsCustomerPicker = !!google && !customerId

  // Load accessible customers when we have a connection but no chosen ID yet.
  useEffect(() => {
    if (!needsCustomerPicker || !google) return
    let cancelled = false
    setCustomersLoading(true)
    setCustomersError(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/v1/ads/google/customers?connectionId=${encodeURIComponent(google.id)}`,
          { headers: { 'X-Org-Id': orgId } },
        )
        const body = await res.json()
        if (cancelled) return
        if (!body.success) {
          setCustomersError(body.error ?? `HTTP ${res.status}`)
          setCustomers([])
        } else {
          const list = (body.data?.customers ?? []) as CustomerSummary[]
          setCustomers(list)
          if (list.length > 0) setSelected(list[0].customerId)
        }
      } catch (err) {
        if (!cancelled) setCustomersError((err as Error).message)
      } finally {
        if (!cancelled) setCustomersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needsCustomerPicker, google, orgId])

  async function startConnect() {
    setConnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/google/oauth/authorize', {
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

  async function saveCustomerId() {
    if (!google || !selected) return
    setSaving(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/v1/ads/google/connections/${encodeURIComponent(google.id)}/customer`,
        {
          method: 'PATCH',
          headers: {
            'X-Org-Id': orgId,
            'Content-Type': 'application/json',
          },
              body: JSON.stringify({
                customerId: selected,
                ...(managerCustomerId.trim() ? { loginCustomerId: managerCustomerId.trim() } : {}),
              }),
        },
      )
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setMessage('Google Ads customer updated.')
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
    if (!google) return
    setDisconnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/connections/google', {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setConfirmDisconnect(false)
      setGoogleDisconnected(true)
      setMessage('Google Ads disconnected.')
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
          aria-label={`Disconnect Google Ads connection for ${orgSlug}?`}
          className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-red-100">Disconnect Google Ads connection?</h2>
              <p className="mt-1 text-sm text-red-100/80">
                This revokes Google Ads account access for this workspace. Campaign history stays in PiB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-red-100/30 px-3 py-2 text-xs font-medium text-red-50 hover:bg-red-50/10 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setConfirmDisconnect(false)}
                disabled={disconnecting}
              >
                Keep Google Ads connected
              </button>
              <button
                type="button"
                className="rounded-md bg-red-300 px-3 py-2 text-xs font-medium text-red-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : `Confirm disconnect Google Ads connection for ${orgSlug}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {(callbackNotice || message || actionError) && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            actionError || (isGoogleCallback && callbackStatus === 'error')
              ? 'border-red-400/30 bg-red-400/10 text-red-200'
              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          }`}
        >
          {actionError ?? callbackNotice ?? message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Google Ads</h2>
          <p className="text-xs text-white/50">
            {google
              ? customerId
                ? `Connected · Customer ${customerId}`
                : 'Connected · pick a Customer ID below'
              : 'Not connected'}
          </p>
        </div>
        {google ? (
          <button
            className="btn-pib-ghost text-sm"
            aria-label={`Disconnect Google Ads connection for ${orgSlug}`}
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
            {connecting ? 'Redirecting…' : 'Connect Google Ads'}
          </button>
        )}
      </div>

      {google && customerId && (
        <div className="mt-4">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-300">
            Customer {customerId}
          </span>
          {loginCustomerId && (
            <span className="ml-2 inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-wide text-white/50">
              Manager {loginCustomerId}
            </span>
          )}
        </div>
      )}

      {needsCustomerPicker && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-medium">Select Customer ID</h3>
          {customersLoading && (
            <p className="text-xs text-white/40">Loading accessible customers…</p>
          )}
          {customersError && (
            <p className="text-xs text-red-300">
              Could not load customers: {customersError}
            </p>
          )}
          {!customersLoading && !customersError && customers.length === 0 && (
            <p className="text-xs text-white/40">
              No accessible customers found. Confirm your Google account has access
              to a Google Ads account.
            </p>
          )}
          {customers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Customer ID"
                className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={saving}
              >
                {customers.map((c) => (
                  <option key={c.customerId} value={c.customerId}>
                    {c.customerId}
                  </option>
                ))}
              </select>
              <input
                aria-label="Manager customer ID"
                className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                placeholder="Manager ID optional"
                value={managerCustomerId}
                onChange={(e) => setManagerCustomerId(e.target.value)}
                disabled={saving}
              />
              <button
                className="btn-pib-accent text-sm"
                onClick={saveCustomerId}
                disabled={saving || !selected}
              >
                {saving ? 'Saving…' : 'Use this customer'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
