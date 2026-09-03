'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, Icon, Notice, Skeleton } from '@/components/studio'

interface PlanConfig {
  planKey: string
  planName: string
  limits: Record<string, number>
  source: string
}
interface ApiEntry {
  id: string
  label: string
  limit: number
  windowMs: number
  source: string
}
interface UsageRow {
  key: string
  count: number
  resetAtMs: number | null
  active: boolean
  ceiling: number | null
}
interface EventRow {
  key: string
  count: number
  ceiling: number | null
  resetAtMs: number | null
  reason: string
}
interface OverrideRow {
  orgId: string
  limit: number | null
  disabled: boolean
  expiresAtMs: number | null
  note: string
  active: boolean
}
interface Data {
  plans: PlanConfig[]
  api: ApiEntry[]
  usage: UsageRow[]
  events: EventRow[]
  overrides: OverrideRow[]
  seeded: string[]
  eventsNote: string
}
interface SessionInfo { isSuperAdmin?: boolean }

function fmtTime(ms: number | null): string {
  if (ms === null) return '-'
  return new Date(ms).toLocaleString()
}
function fmtWindow(ms: number): string {
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`
  if (ms % 60000 === 0) return `${ms / 60000}m`
  return `${Math.round(ms / 1000)}s`
}

export default function RateLimitsClient() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [savingPlan, setSavingPlan] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})

  // override form
  const [ovOrg, setOvOrg] = useState('')
  const [ovLimit, setOvLimit] = useState('')
  const [ovTtl, setOvTtl] = useState('60')
  const [ovDisabled, setOvDisabled] = useState(false)
  const [ovBusy, setOvBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/system/rate-limits')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      const d: Data = body.data ?? body
      setData(d)
      // hydrate edit buffers
      const buf: Record<string, Record<string, string>> = {}
      for (const p of d.plans) {
        buf[p.planKey] = Object.fromEntries(Object.entries(p.limits).map(([k, v]) => [k, String(v)]))
      }
      setEdits(buf)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify').then((r) => (r.ok ? r.json() : null))
      .then((s: SessionInfo | null) => { if (!cancelled) setIsSuperAdmin(Boolean(s?.isSuperAdmin)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function savePlan(planKey: string) {
    setSavingPlan(planKey)
    try {
      const limits: Record<string, number> = {}
      for (const [k, v] of Object.entries(edits[planKey] ?? {})) {
        const n = Number(v)
        if (!Number.isNaN(n)) limits[k] = n
      }
      const res = await fetch('/api/v1/admin/system/rate-limits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'plan', planKey, limits }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Save failed')
      flash(`Saved limits for ${planKey}`)
      load()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingPlan(null)
    }
  }

  async function submitOverride(e: React.FormEvent) {
    e.preventDefault()
    setOvBusy(true)
    try {
      const res = await fetch('/api/v1/admin/system/rate-limits/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: ovOrg.trim(),
          limit: ovLimit ? Number(ovLimit) : undefined,
          disabled: ovDisabled,
          ttlMinutes: Number(ovTtl) || 60,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Override failed')
      flash(`Override set for ${ovOrg}`)
      setOvOrg(''); setOvLimit(''); setOvDisabled(false); setOvTtl('60')
      load()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Override failed')
    } finally {
      setOvBusy(false)
    }
  }

  async function clearOverride(orgId: string) {
    try {
      const res = await fetch(`/api/v1/admin/system/rate-limits/override?orgId=${encodeURIComponent(orgId)}`, { method: 'DELETE' })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Clear failed') }
      flash(`Cleared override for ${orgId}`)
      load()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Clear failed')
    }
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <PageHeader
        eyebrow="System · Ops"
        title="Rate limits."
        description="Per-plan usage limits and per-API request ceilings, live usage counters, at-ceiling events, and temporary per-org overrides."
        actions={(
          <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh rate limits">
            <Icon name="refresh" />
            Refresh
          </Button>
        )}
      />

      {toast ? <Notice tone="success">{toast}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {data?.seeded && data.seeded.length > 0 ? (
        <Notice tone="info">Seeded config docs from real defaults: {data.seeded.join(', ')}</Notice>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-64 rounded-[6px]" />
      ) : data ? (
        <>
          {/* Per-plan editable limits */}
          <section className="st-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-pib-line)]">
              <h2 className="sc-tiny">Per-plan usage limits</h2>
              <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-0.5">Seeded from the live plans collection. -1 = unlimited. Editable by super-admins.</p>
            </div>
            {data.plans.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-pib-text-muted)]">No plans defined yet.</div>
            ) : (
              <div className="divide-y divide-[var(--color-pib-line)]">
                {data.plans.map((p) => {
                  const keys = Object.keys(p.limits)
                  return (
                    <div key={p.planKey} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-sm font-medium text-[var(--color-pib-text)]">{p.planName}</span>
                          <span className="ml-2 text-[10px] font-mono text-[var(--color-pib-text-muted)]">{p.planKey}</span>
                        </div>
                        {isSuperAdmin && (
                          <button onClick={() => savePlan(p.planKey)} disabled={savingPlan === p.planKey} className="st-btn st-btn--primary st-btn--sm font-label disabled:opacity-50">
                            {savingPlan === p.planKey ? 'Saving...' : 'Save'}
                          </button>
                        )}
                      </div>
                      {keys.length === 0 ? (
                        <p className="text-xs text-[var(--color-pib-text-muted)]">No limits configured.</p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          {keys.map((k) => (
                            <label key={k} className="space-y-1">
                              <span className="sc-tiny">{k}</span>
                              <input
                                type="number"
                                disabled={!isSuperAdmin}
                                className="st-input w-full text-sm font-mono disabled:opacity-60"
                                value={edits[p.planKey]?.[k] ?? String(p.limits[k])}
                                onChange={(e) => setEdits((prev) => ({ ...prev, [p.planKey]: { ...prev[p.planKey], [k]: e.target.value } }))}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Per-API ceilings (read-only display of real call-site limits) */}
          <section className="st-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-pib-line)]">
              <h2 className="sc-tiny">Per-API request ceilings</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[var(--color-pib-text-muted)] border-b border-[var(--color-pib-line)]">
                  <th className="px-3 py-2 font-label">Endpoint</th>
                  <th className="px-3 py-2 font-label">Limit</th>
                  <th className="px-3 py-2 font-label">Window</th>
                  <th className="px-3 py-2 font-label">Source</th>
                </tr></thead>
                <tbody>
                  {data.api.map((a) => (
                    <tr key={a.id} className="border-b border-[var(--color-pib-line)]">
                      <td className="px-3 py-2 text-[var(--color-pib-text)]">{a.label}</td>
                      <td className="px-3 py-2 font-mono text-[var(--color-pib-text)]">{a.limit}</td>
                      <td className="px-3 py-2 font-mono text-[var(--color-pib-text-muted)]">{fmtWindow(a.windowMs)}</td>
                      <td className="px-3 py-2 font-mono text-[var(--color-pib-text-muted)] truncate max-w-[220px]" title={a.source}>{a.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Live usage */}
          <section className="st-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-pib-line)] flex items-center justify-between">
              <h2 className="sc-tiny">Live usage counters</h2>
              <span className="text-xs text-[var(--color-pib-text-muted)]">{data.usage.length} keys</span>
            </div>
            {data.usage.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-pib-text-muted)]">No active rate-limit counters.</div>
            ) : (
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--color-pib-bg)]"><tr className="text-left text-[var(--color-pib-text-muted)] border-b border-[var(--color-pib-line)]">
                    <th className="px-3 py-2 font-label">Key</th>
                    <th className="px-3 py-2 font-label">Count</th>
                    <th className="px-3 py-2 font-label">Ceiling</th>
                    <th className="px-3 py-2 font-label">Resets</th>
                  </tr></thead>
                  <tbody>
                    {data.usage.map((u) => (
                      <tr key={u.key} className="border-b border-[var(--color-pib-line)]">
                        <td className="px-3 py-2 font-mono text-[var(--color-pib-text-muted)] truncate max-w-[280px]" title={u.key}>{u.key}</td>
                        <td className={`px-3 py-2 font-mono ${u.ceiling !== null && u.count >= u.ceiling ? 'text-[var(--color-error)]' : 'text-[var(--color-pib-text)]'}`}>{u.count}</td>
                        <td className="px-3 py-2 font-mono text-[var(--color-pib-text-muted)]">{u.ceiling ?? '-'}</td>
                        <td className="px-3 py-2 text-[var(--color-pib-text-muted)] whitespace-nowrap">{u.active ? fmtTime(u.resetAtMs) : 'expired'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Events */}
          <section className="st-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-pib-line)]">
              <h2 className="sc-tiny">At-ceiling events</h2>
              <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-0.5">{data.eventsNote}</p>
            </div>
            {data.events.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-pib-text-muted)]">No keys currently at their ceiling.</div>
            ) : (
              <div className="divide-y divide-[var(--color-pib-line)]">
                {data.events.map((ev) => (
                  <div key={ev.key} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <Icon name="block" />
                    <span className="font-mono text-[var(--color-pib-text)] flex-1 truncate" title={ev.key}>{ev.key}</span>
                    <span className="text-[var(--color-error)]">{ev.count}/{ev.ceiling}</span>
                    <span className="text-[var(--color-pib-text-muted)] whitespace-nowrap">resets {fmtTime(ev.resetAtMs)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Overrides */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="st-panel p-4">
              <h2 className="sc-tiny mb-3">Temporary per-org override</h2>
              {!isSuperAdmin ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">Super-admin only.</p>
              ) : (
                <form onSubmit={submitOverride} className="space-y-3">
                  <label className="space-y-1 block">
                    <span className="sc-tiny">Org ID</span>
                    <input className="st-input w-full font-mono text-sm" value={ovOrg} onChange={(e) => setOvOrg(e.target.value)} required />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="sc-tiny">Bumped limit</span>
                      <input type="number" className="st-input w-full text-sm font-mono disabled:opacity-50" value={ovLimit} onChange={(e) => setOvLimit(e.target.value)} disabled={ovDisabled} placeholder="e.g. 500" />
                    </label>
                    <label className="space-y-1">
                      <span className="sc-tiny">TTL (minutes)</span>
                      <input type="number" className="st-input w-full text-sm font-mono" value={ovTtl} onChange={(e) => setOvTtl(e.target.value)} />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                    <input type="checkbox" checked={ovDisabled} onChange={(e) => setOvDisabled(e.target.checked)} />
                    Disable rate limiting entirely for this org (during TTL)
                  </label>
                  <button type="submit" disabled={ovBusy} className="st-btn st-btn--primary text-xs font-label disabled:opacity-50">
                    {ovBusy ? 'Applying...' : 'Apply override'}
                  </button>
                </form>
              )}
            </div>

            <div className="st-panel p-4">
              <h2 className="sc-tiny mb-3">Active overrides</h2>
              {data.overrides.length === 0 ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">No overrides set.</p>
              ) : (
                <div className="space-y-2">
                  {data.overrides.map((o) => (
                    <div key={o.orgId} className="flex items-center gap-2 text-xs border-b border-[var(--color-pib-line)] pb-2">
                      <span className="font-mono text-[var(--color-pib-text)] flex-1 truncate" title={o.orgId}>{o.orgId}</span>
                      <span className={o.disabled ? "text-[var(--color-error)]" : "text-[var(--st-success)]"}>{o.disabled ? 'disabled' : `limit ${o.limit}`}</span>
                      <span className="text-[var(--color-pib-text-muted)] whitespace-nowrap">{o.active ? `until ${fmtTime(o.expiresAtMs)}` : 'expired'}</span>
                      {isSuperAdmin && (
                        <button onClick={() => clearOverride(o.orgId)} className="st-btn st-btn--ghost text-[11px] font-label text-[var(--color-error)]">Clear</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
