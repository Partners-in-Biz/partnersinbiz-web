// components/admin/governance/DomainsManager.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

type SslStatus = 'pending' | 'active' | 'failed'

interface DomainRow {
  orgId: string
  orgName: string
  slug: string
  subdomain: string
  customDomain: string
  portalAlias: string
  verified: boolean
  sslStatus: SslStatus
  dnsTarget: string
  verifiedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

interface DomainsResult {
  rows: DomainRow[]
  scope: 'all' | 'restricted'
  cnameTarget: string
  rootDomain: string
  counts: { total: number; verified: number; active: number; pending: number; failed: number }
}

const EMPTY: DomainsResult = {
  rows: [],
  scope: 'all',
  cnameTarget: 'cname.partnersinbiz.online',
  rootDomain: 'partnersinbiz.online',
  counts: { total: 0, verified: 0, active: 0, pending: 0, failed: 0 },
}

function fmt(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString().replace('T', ' ').slice(0, 16)
}

function sslBadge(status: SslStatus): string {
  if (status === 'active') return 'bg-green-500/15 text-green-300'
  if (status === 'failed') return 'bg-red-500/15 text-red-300'
  return 'bg-amber-500/15 text-amber-300'
}

export function DomainsManager() {
  const [data, setData] = useState<DomainsResult>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/domains', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load domains')
      setData({ ...EMPTY, ...(body.data ?? body) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load domains.')
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const runAction = useCallback(
    async (orgId: string, action: 'verify' | 'provision-ssl') => {
      setBusy(`${orgId}:${action}`)
      setNotice(null)
      try {
        const res = await fetch('/api/v1/admin/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, action }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Action failed')
        const payload = body.data ?? body
        if (action === 'verify') {
          setNotice(
            payload.verified
              ? { tone: 'ok', text: `DNS verified — SSL is now active for ${orgId}.` }
              : { tone: 'warn', text: `DNS not yet pointing at ${data.cnameTarget}. ${payload.domain?.lastError ?? ''}` },
          )
        } else {
          setNotice({ tone: 'ok', text: `SSL provisioned for ${orgId}.` })
        }
        await load()
      } catch (e) {
        setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Action failed.' })
      } finally {
        setBusy(null)
      }
    },
    [data.cnameTarget, load],
  )

  const revoke = useCallback(
    async (orgId: string, label: string) => {
      if (!window.confirm(`Revoke the white-label domain for ${label}? The portal will fall back to the platform domain.`)) {
        return
      }
      setBusy(`${orgId}:revoke`)
      setNotice(null)
      try {
        const res = await fetch(`/api/v1/admin/domains?orgId=${encodeURIComponent(orgId)}`, { method: 'DELETE' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Revoke failed')
        setNotice({ tone: 'ok', text: `Revoked white-label domain for ${label}.` })
        await load()
      } catch (e) {
        setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Revoke failed.' })
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Governance</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">White-label Domains</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Provision and manage custom client portal domains across{' '}
            {data.scope === 'restricted' ? 'your assigned' : 'all'} organisations — verify DNS, provision SSL, or revoke.
          </p>
        </div>
        <a
          href="/api/v1/admin/domains/export"
          className="shrink-0 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-4 py-2 text-sm font-medium text-on-surface hover:bg-[var(--color-row-hover)] transition-colors"
        >
          Export CSV
        </a>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Custom domains', value: data.counts.total },
          { label: 'Verified', value: data.counts.verified },
          { label: 'Active SSL', value: data.counts.active },
          { label: 'Pending', value: data.counts.pending },
        ].map((m) => (
          <div key={m.label} className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{m.label}</p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-xs text-on-surface-variant">
        DNS target — every custom domain must CNAME to{' '}
        <span className="font-mono text-on-surface">{data.cnameTarget}</span>
      </div>

      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            notice.tone === 'ok'
              ? 'border-green-500/20 bg-green-500/10 text-green-300'
              : notice.tone === 'warn'
                ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--color-card-border)]">
        <table className="w-full text-left text-sm text-on-surface">
          <thead>
            <tr className="border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)]">
              {['Domain', 'Organization', 'Portal alias', 'Verified', 'SSL', 'Last checked', 'Actions'].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">
                  Loading domains…
                </td>
              </tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">
                  No custom domains are configured in the accessible org scope.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => {
                const verifyBusy = busy === `${row.orgId}:verify`
                const sslBusy = busy === `${row.orgId}:provision-ssl`
                const revokeBusy = busy === `${row.orgId}:revoke`
                return (
                  <tr
                    key={row.orgId}
                    className="border-b border-[var(--color-card-border)] last:border-b-0 hover:bg-[var(--color-row-hover)] transition-colors align-top"
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium text-on-surface font-mono text-xs break-all">
                        {row.customDomain || 'No custom domain'}
                      </p>
                      {row.lastError && <p className="text-[11px] text-amber-300/80 mt-0.5">{row.lastError}</p>}
                    </td>
                    <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap">
                      <a className="hover:text-on-surface" href={`/admin/org/${row.slug}/settings`}>
                        {row.orgName}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-on-surface-variant break-all">
                      {row.portalAlias || 'Not assigned'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                          row.verified ? 'bg-green-500/15 text-green-300' : 'bg-[var(--color-surface-container)] text-on-surface-variant'
                        }`}
                      >
                        {row.verified ? `Yes (${fmt(row.verifiedAt)})` : 'No'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${sslBadge(row.sslStatus)}`}>
                        {row.sslStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-on-surface-variant whitespace-nowrap">{fmt(row.lastCheckedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={verifyBusy || !row.customDomain}
                          onClick={() => runAction(row.orgId, 'verify')}
                          className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-50 transition-colors"
                        >
                          {verifyBusy ? 'Checking…' : 'Verify DNS'}
                        </button>
                        <button
                          type="button"
                          disabled={sslBusy || !row.verified || row.sslStatus === 'active'}
                          onClick={() => runAction(row.orgId, 'provision-ssl')}
                          className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-50 transition-colors"
                        >
                          {sslBusy ? 'Provisioning…' : 'Provision SSL'}
                        </button>
                        <button
                          type="button"
                          disabled={revokeBusy || (!row.customDomain && !row.subdomain)}
                          onClick={() => revoke(row.orgId, row.orgName)}
                          className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                        >
                          {revokeBusy ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
