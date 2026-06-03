'use client'
import { useState } from 'react'
import type { AdConnection } from '@/lib/ads/types'

interface Props {
  orgSlug: string
  orgId: string
  connections: AdConnection[]
}

export function ConnectionsPanel({ orgSlug, orgId, connections }: Props) {
  const [metaDisconnected, setMetaDisconnected] = useState(false)
  const meta = metaDisconnected ? undefined : connections.find((c) => c.platform === 'meta')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function startConnect() {
    setConnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/connections/meta/authorize', {
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

  function requestDisconnect() {
    setActionError(null)
    setMessage(null)
    setConfirmDisconnect(true)
  }

  async function disconnect() {
    setDisconnecting(true)
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/ads/connections/meta', {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (body.success) {
        setConfirmDisconnect(false)
        setMetaDisconnected(true)
        setMessage('Meta ads disconnected.')
      } else {
        setActionError(body.error ?? 'Failed to disconnect Meta ads.')
      }
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setDisconnecting(false)
    }
  }

  async function refreshAccounts() {
    setActionError(null)
    setMessage(null)
    const res = await fetch('/api/v1/ads/connections/meta/ad-accounts?refresh=1', {
      headers: { 'X-Org-Id': orgId },
    })
    const body = await res.json()
    if (body.success) {
      setMessage('Meta ad accounts refreshed.')
      window.location.reload()
    } else {
      setActionError(body.error ?? 'Failed to refresh Meta ad accounts.')
    }
  }

  async function setDefault(adAccountId: string) {
    setActionError(null)
    setMessage(null)
    const res = await fetch(
      `/api/v1/ads/connections/meta/ad-accounts/${encodeURIComponent(adAccountId)}`,
      { method: 'PATCH', headers: { 'X-Org-Id': orgId } },
    )
    const body = await res.json()
    if (body.success) {
      setMessage('Default Meta ad account updated.')
      window.location.reload()
    } else {
      setActionError(body.error ?? 'Failed to set default Meta ad account.')
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Ad platform connections</h1>
        <p className="text-sm text-white/60 mt-1">
          Link ad platforms to manage paid social campaigns from PiB for {orgSlug}.
        </p>
      </header>

      {confirmDisconnect && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Disconnect Meta ads connection for ${orgSlug}?`}
          className="rounded-lg border border-red-400/30 bg-red-400/10 p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-red-100">Disconnect Meta ads connection?</h2>
              <p className="mt-1 text-sm text-red-100/80">
                This revokes Meta ad account access for this workspace. Campaign history stays in PiB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-red-100/30 px-3 py-2 text-xs font-medium text-red-50 hover:bg-red-50/10 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setConfirmDisconnect(false)}
                disabled={disconnecting}
              >
                Keep Meta connected
              </button>
              <button
                type="button"
                className="rounded-md bg-red-300 px-3 py-2 text-xs font-medium text-red-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : `Confirm disconnect Meta ads connection for ${orgSlug}`}
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

      <div className="rounded-lg border border-white/10 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Meta (Facebook + Instagram)</h2>
            <p className="text-xs text-white/50">
              {meta
                ? `Connected · ${meta.adAccounts.length} ad account${meta.adAccounts.length === 1 ? '' : 's'}`
                : 'Not connected'}
            </p>
          </div>
          {meta ? (
            <button
              className="btn-pib-ghost text-sm"
              aria-label={`Disconnect Meta ads connection for ${orgSlug}`}
              onClick={requestDisconnect}
            >
              Disconnect
            </button>
          ) : (
            <button
              className="btn-pib-accent text-sm"
              onClick={startConnect}
              disabled={connecting}
            >
              {connecting ? 'Redirecting…' : 'Connect Meta'}
            </button>
          )}
        </div>

        {meta && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Ad accounts</h3>
              <button className="text-xs text-white/60 underline" onClick={refreshAccounts}>
                Refresh
              </button>
            </div>
            <ul className="space-y-1">
              {meta.adAccounts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded border border-white/5 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-white/40">
                      {a.id} · {a.currency} · {a.timezone}
                    </div>
                  </div>
                  {meta.defaultAdAccountId === a.id ? (
                    <span className="text-xs uppercase tracking-wide text-[#F5A623]">
                      Default
                    </span>
                  ) : (
                    <button
                      className="text-xs text-white/60 underline"
                      onClick={() => setDefault(a.id)}
                    >
                      Set default
                    </button>
                  )}
                </li>
              ))}
              {meta.adAccounts.length === 0 && (
                <li className="text-sm text-white/40">
                  No ad accounts found. Click Refresh after granting more permissions in Meta.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
