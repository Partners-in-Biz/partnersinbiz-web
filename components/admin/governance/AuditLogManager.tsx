// components/admin/governance/AuditLogManager.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface AuditRow {
  id: string
  orgId: string
  orgName: string
  type: string
  actorId: string
  actorName: string
  actorRole: string
  description: string
  entityType: string
  entityId: string
  oldValue: string
  newValue: string
  ip: string
  createdAt: string
  sensitive: boolean
}

interface AuditAlert {
  id: string
  severity: 'high' | 'medium'
  actorId: string
  actorName: string
  kind: string
  count: number
  windowMinutes: number
  message: string
  sampleActions: string[]
}

interface AuditLogResult {
  rows: AuditRow[]
  alerts: AuditAlert[]
  total: number
  scanned: number
  scope: 'all' | 'restricted'
  actors: Array<{ id: string; name: string }>
  actions: string[]
}

interface Filters {
  actor: string
  action: string
  from: string
  to: string
}

const EMPTY: AuditLogResult = {
  rows: [],
  alerts: [],
  total: 0,
  scanned: 0,
  scope: 'all',
  actors: [],
  actions: [],
}

const inputClass =
  'mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-soft)] px-3 py-2 text-sm text-[var(--color-pib-text)]'

export function AuditLogManager() {
  const [filters, setFilters] = useState<Filters>({ actor: '', action: '', from: '', to: '' })
  const [applied, setApplied] = useState<Filters>({ actor: '', action: '', from: '', to: '' })
  const [data, setData] = useState<AuditLogResult>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (applied.actor) params.set('actor', applied.actor)
    if (applied.action) params.set('action', applied.action)
    if (applied.from) params.set('from', applied.from)
    if (applied.to) params.set('to', applied.to)
    return params.toString()
  }, [applied])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/audit-log${queryString ? `?${queryString}` : ''}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load audit log')
      const result: AuditLogResult = body.data ?? body
      setData({ ...EMPTY, ...result })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load audit log.')
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    load()
  }, [load])

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function applyFilters() {
    setApplied(filters)
  }

  function resetFilters() {
    const cleared = { actor: '', action: '', from: '', to: '' }
    setFilters(cleared)
    setApplied(cleared)
  }

  const exportHref = `/api/v1/admin/audit-log/export${queryString ? `?${queryString}` : ''}`

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1">
            Governance
          </p>
          <h1 className="text-2xl font-headline font-medium text-[var(--color-pib-text)]">Audit Log</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
            Immutable record of platform activity across {data.scope === 'restricted' ? 'your assigned' : 'all'} organisations,
            with suspicious-activity alerting and old → new change tracking.
          </p>
        </div>
        <a
          href={exportHref}
          className="shrink-0 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-soft)] px-4 py-2 text-sm font-medium text-[var(--color-pib-text)] hover:bg-[var(--color-row-hover)] transition-colors"
        >
          Export CSV
        </a>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-[color-mix(in_srgb,var(--st-warning)_5%,transparent)] p-4 space-y-3">
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--st-warning)]">
            Suspicious activity  -  {data.alerts.length} alert{data.alerts.length === 1 ? '' : 's'}
          </p>
          <div className="space-y-2">
            {data.alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border px-3 py-2.5 ${
                  alert.severity === 'high'
                    ? 'border-red-500/30 bg-red-500/10'
                    : 'border-amber-500/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-label uppercase tracking-widest px-2 py-0.5 rounded-md ${
                      alert.severity === 'high'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-[color-mix(in_srgb,var(--st-warning)_20%,transparent)] text-[var(--st-warning)]'
                    }`}
                  >
                    {alert.severity}
                  </span>
                  <span className="text-sm font-medium text-[var(--color-pib-text)]">{alert.message}</span>
                </div>
                {alert.sampleActions.length > 0 && (
                  <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
                    Actions: {alert.sampleActions.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="pib-card space-y-4">
        <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Filters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-[var(--color-pib-text-muted)]">Admin (actor)</label>
            <input aria-label="Name or ID"
              className={inputClass}
              list="audit-actor-list"
              placeholder="Name or ID"
              value={filters.actor}
              onChange={(e) => set('actor', e.target.value)}
            />
            <datalist id="audit-actor-list">
              {data.actors.map((actor) => (
                <option key={actor.id} value={actor.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-[var(--color-pib-text-muted)]">Action (type)</label>
            <input aria-label="e.g. delete, billing"
              className={inputClass}
              list="audit-action-list"
              placeholder="e.g. delete, billing"
              value={filters.action}
              onChange={(e) => set('action', e.target.value)}
            />
            <datalist id="audit-action-list">
              {data.actions.map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-[var(--color-pib-text-muted)]">From</label>
            <input aria-label="From"
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => set('from', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-pib-text-muted)]">To</label>
            <input aria-label="To"
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => set('to', e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-medium text-black hover:opacity-90 transition-opacity"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            Reset
          </button>
          <span className="text-xs text-[var(--color-pib-text-muted)] ml-auto">
            {loading ? 'Loading…' : `${data.total} match${data.total === 1 ? '' : 'es'} · scanned ${data.scanned}`}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-[var(--color-card-border)]">
        <table className="w-full text-left text-sm text-[var(--color-pib-text)]">
          <thead>
            <tr className="border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-soft)]">
              {['When', 'Actor', 'Action', 'Organization', 'Entity', 'Old → New', 'IP', 'Summary'].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[var(--color-pib-text-muted)]">
                  Loading audit activity…
                </td>
              </tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[var(--color-pib-text-muted)]">
                  No audit activity matches the current filters.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-[var(--color-card-border)] last:border-b-0 hover:bg-[var(--color-row-hover)] transition-colors ${
                    row.sensitive ? 'bg-[color-mix(in_srgb,var(--st-warning)_5%,transparent)]' : ''
                  }`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--color-pib-text-muted)] align-top">
                    {row.createdAt || ' - '}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium text-[var(--color-pib-text)] whitespace-nowrap">{row.actorName || ' - '}</p>
                    {row.actorRole && (
                      <p className="text-[11px] text-[var(--color-pib-text-muted)]">{row.actorRole}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`whitespace-nowrap ${
                        row.sensitive
                          ? 'inline-block rounded px-1.5 py-0.5 text-xs bg-[color-mix(in_srgb,var(--st-warning)_15%,transparent)] text-[var(--st-warning)]'
                          : 'pib-pill pib-pill-cyan'
                      }`}
                    >
                      {row.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-[var(--color-pib-text-muted)] whitespace-nowrap">{row.orgName}</td>
                  <td className="px-3 py-2 align-top text-[var(--color-pib-text-muted)]">
                    {row.entityType || row.entityId ? (
                      <>
                        <span className="text-xs">{row.entityType || 'entity'}</span>
                        {row.entityId && (
                          <span className="block text-[11px] opacity-70 font-mono truncate max-w-[120px]">
                            {row.entityId}
                          </span>
                        )}
                      </>
                    ) : (
                      ' - '
                    )}
                  </td>
                  <td className="px-3 py-2 align-top max-w-[240px]">
                    {row.oldValue || row.newValue ? (
                      <div className="text-xs">
                        {row.oldValue && (
                          <span className="text-red-300/80 break-words">{row.oldValue}</span>
                        )}
                        {row.oldValue && row.newValue && (
                          <span className="text-[var(--color-pib-text-muted)]"> → </span>
                        )}
                        {row.newValue && (
                          <span className="text-green-300/80 break-words">{row.newValue}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--color-pib-text-muted)]"> - </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs font-mono text-[var(--color-pib-text-muted)] whitespace-nowrap">
                    {row.ip || ' - '}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-[var(--color-pib-text-muted)] max-w-[260px]">
                    <span className="break-words">{row.description || ' - '}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
