// app/(portal)/portal/settings/audit-log/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { appendQueryParams, scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type AuditEntry = {
  id: string
  when: string | null
  actorName: string
  actorRole: string
  action: string
  target: string
  details: string
}

type AuditResponse = {
  data?: { entries: AuditEntry[]; count: number; actions: string[] }
  error?: string
}

function humanAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function AuditLogPage() {
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)
  const baseEndpoint = useMemo(() => scopedApiPath('/api/v1/org/audit-log', scope), [scope])

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const queryParams = useMemo(
    () => ({ action: action || undefined, actor: actor || undefined, from: from || undefined, to: to || undefined, limit: 500 }),
    [action, actor, from, to],
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    const url = appendQueryParams(baseEndpoint, queryParams)
    fetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as AuditResponse
        if (!res.ok) throw new Error(body.error ?? 'Failed to load audit log')
        return body
      })
      .then((body) => {
        if (!alive) return
        setEntries(body.data?.entries ?? [])
        // Keep the union of known actions so the dropdown doesn't collapse when filtered.
        setActions((prev) => Array.from(new Set([...prev, ...(body.data?.actions ?? [])])).sort())
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load audit log')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [baseEndpoint, queryParams])

  function exportCsv() {
    const url = appendQueryParams(baseEndpoint, { ...queryParams, format: 'csv', limit: 5000 })
    window.open(url, '_blank')
  }

  function clearFilters() {
    setAction('')
    setActor('')
    setFrom('')
    setTo('')
  }

  const hasFilters = action || actor || from || to

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Security &amp; compliance</p>
          <h1 className="pib-page-title mt-2">Audit log</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Every meaningful action across your workspace — who did what, and when. Filter and export for compliance reviews.
          </p>
        </div>
        <button type="button" onClick={exportCsv} className="pib-btn-secondary shrink-0 inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="pib-card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-action" className="pib-label !mb-0">Action</label>
          <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="pib-input">
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{humanAction(a)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-actor" className="pib-label !mb-0">Who</label>
          <input
            id="audit-actor"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="Search actor..."
            className="pib-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-from" className="pib-label !mb-0">From</label>
          <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="pib-input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-to" className="pib-label !mb-0">To</label>
          <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="pib-input" />
        </div>
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="button" onClick={clearFilters} className="text-sm text-[var(--color-pib-accent)] hover:underline">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Table */}
      <div className="pib-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)] text-left text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--color-pib-line)]">
                    <td className="px-4 py-3" colSpan={5}>
                      <div className="h-4 w-full max-w-xl rounded bg-[var(--color-pib-surface-soft)]" />
                    </td>
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)]">history</span>
                    <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                      {hasFilters ? 'No audit entries match these filters.' : 'No audit activity recorded yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--color-pib-line)] last:border-0 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--color-pib-text-muted)]">
                      {e.when ? new Date(e.when).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-pib-text)]">{e.actorName || '—'}</div>
                      {e.actorRole && <div className="text-xs text-[var(--color-pib-text-muted)]">{e.actorRole}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="pib-pill">{humanAction(e.action)}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{e.target || '—'}</td>
                    <td className="px-4 py-3 text-[var(--color-pib-text)]">{e.details || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
