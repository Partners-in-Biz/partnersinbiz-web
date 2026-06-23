'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ListHealthReport,
  ListHealthBreakdown,
  SuggestedAction,
  CleaningHistoryEntry,
} from '@/lib/email-analytics/list-health'

interface ListHealthWorkspaceProps {
  orgId?: string
  orgName?: string
}

function scopedUrl(path: string, orgId?: string) {
  const search = new URLSearchParams()
  const clean = orgId?.trim()
  if (clean) search.set('orgId', clean)
  const q = search.toString()
  return q ? `${path}?${q}` : path
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-pib-accent)'
  if (score >= 60) return '#FBBF24'
  return '#F87171'
}

const BUCKET_META: Array<{
  key: keyof Omit<ListHealthBreakdown, 'total'>
  label: string
  tone: string
}> = [
  { key: 'active90d', label: 'Active (90d)', tone: 'text-[var(--color-pib-accent)]' },
  { key: 'neverOpened', label: 'Never opened', tone: 'text-amber-300' },
  { key: 'inactive180d', label: 'Inactive (180d+)', tone: 'text-[#F87171]' },
  { key: 'invalidFormat', label: 'Invalid format', tone: 'text-[#F87171]' },
  { key: 'unsubscribed', label: 'Unsubscribed', tone: 'text-[var(--color-pib-text-muted)]' },
  { key: 'bounced', label: 'Bounced', tone: 'text-[#F87171]' },
]

function HealthScore({ score }: { score: number }) {
  const color = scoreColor(score)
  return (
    <div className="bento-card !p-6 flex items-center gap-5">
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: 96,
          height: 96,
          background: `conic-gradient(${color} ${score * 3.6}deg, var(--color-pib-line) ${score * 3.6}deg)`,
        }}
      >
        <div className="flex items-center justify-center rounded-full bg-[var(--color-pib-surface)]" style={{ width: 76, height: 76 }}>
          <span className="font-display text-3xl" style={{ color }}>
            {score}
          </span>
        </div>
      </div>
      <div>
        <p className="eyebrow !text-[10px]">List health score</p>
        <p className="text-sm text-[var(--color-pib-text-muted)] max-w-sm mt-1">
          Share of your list that is deliverable and engaged. Suppress inactive contacts to lift it.
        </p>
      </div>
    </div>
  )
}

function BucketGrid({ breakdown }: { breakdown: ListHealthBreakdown }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {BUCKET_META.map((b) => (
        <div key={b.key} className="bento-card !p-4">
          <p className="eyebrow !text-[10px]">{b.label}</p>
          <p className={`font-display text-2xl mt-1 ${b.tone}`}>{breakdown[b.key].toLocaleString()}</p>
        </div>
      ))}
    </div>
  )
}

function HistoryTable({ history }: { history: CleaningHistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <div className="bento-card !p-6 text-sm text-[var(--color-pib-text-muted)]">
        No cleaning runs yet.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-pib-line)]">
      <table className="w-full text-sm">
        <thead className="bg-white/[0.02]">
          <tr className="text-left">
            <th className="px-3 py-2 eyebrow !text-[10px]">When</th>
            <th className="px-3 py-2 eyebrow !text-[10px]">Action</th>
            <th className="px-3 py-2 eyebrow !text-[10px]">Affected</th>
            <th className="px-3 py-2 eyebrow !text-[10px]">Note</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-t border-[var(--color-pib-line)] align-top">
              <td className="px-3 py-2 text-xs text-[var(--color-pib-text-muted)] whitespace-nowrap">
                {h.performedAt ? new Date(h.performedAt).toLocaleString() : '—'}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{h.action}</td>
              <td className="px-3 py-2">{h.affectedCount.toLocaleString()}</td>
              <td className="px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">{h.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ListHealthWorkspace({ orgId, orgName }: ListHealthWorkspaceProps) {
  const scopedOrgId = orgId?.trim() || undefined
  const endpoint = scopedUrl('/api/v1/email/list-health', scopedOrgId)
  const tenantHeaders = useMemo<Record<string, string> | undefined>(
    () => (scopedOrgId ? { 'X-Org-Id': scopedOrgId } : undefined),
    [scopedOrgId],
  )

  const [report, setReport] = useState<ListHealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(endpoint, tenantHeaders ? { headers: tenantHeaders } : undefined)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success === false) {
          setError(body.error ?? 'Failed to load list health')
          return
        }
        setReport((body.data ?? body) as ListHealthReport)
      })
      .catch(() => setError('Failed to load list health'))
      .finally(() => setLoading(false))
  }, [endpoint, tenantHeaders])

  useEffect(() => {
    load()
  }, [load])

  async function runSuppressInactive() {
    setCleaning(true)
    setError(null)
    setFlash(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...(tenantHeaders ?? {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suppress-inactive', ...(scopedOrgId ? { orgId: scopedOrgId } : {}) }),
      })
      const body = await res.json()
      if (!res.ok || body?.success === false) {
        setError(body.error ?? 'Failed to suppress inactive contacts')
        return
      }
      const data = body.data ?? body
      setFlash(`Suppressed ${data.suppressed} inactive contacts (flagged ${data.flagged}).`)
      setConfirmOpen(false)
      load()
    } catch {
      setError('Failed to suppress inactive contacts')
    } finally {
      setCleaning(false)
    }
  }

  const inactiveCount =
    report?.suggestedActions.find((a: SuggestedAction) => a.code === 'suppress-inactive')?.affected ?? 0

  return (
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">{orgName || 'List hygiene'}</p>
          <h1 className="pib-page-title mt-2">List Health</h1>
          <p className="pib-page-sub max-w-2xl">
            Score your contact list, see the active / inactive / never-opened / invalid breakdown, and
            clean inactive contacts in one click.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-pib-secondary disabled:opacity-50" type="button">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-50">{error}</div>
      )}
      {flash && (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
          {flash}
        </div>
      )}

      {loading && !report ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-24" />
          ))}
        </div>
      ) : report ? (
        <>
          <section className="grid gap-4 lg:grid-cols-[320px_1fr] items-start">
            <HealthScore score={report.healthScore} />
            <div className="bento-card !p-5 flex flex-col gap-3">
              <div>
                <p className="eyebrow !text-[10px]">One-click clean</p>
                <p className="text-sm mt-1">
                  {inactiveCount > 0
                    ? `${inactiveCount.toLocaleString()} contacts have had no engagement in 180+ days.`
                    : 'No inactive contacts to suppress right now.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={inactiveCount === 0 || cleaning}
                className="btn-pib-accent disabled:opacity-50 self-start"
              >
                Suppress inactive
              </button>
            </div>
          </section>

          {confirmOpen && (
            <section
              role="alertdialog"
              aria-label="Confirm suppress inactive contacts"
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">
                    warning
                  </span>
                  <div>
                    <h3 className="font-display text-lg text-amber-50">
                      Suppress {inactiveCount.toLocaleString()} inactive contacts?
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm text-amber-50/90">
                      They&apos;ll be added to the suppression list (reason: list cleanup) and flagged on
                      their contact record. This protects sender reputation and is recorded in cleaning
                      history. Contacts are not deleted.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(false)}
                    disabled={cleaning}
                    className="btn-pib-secondary text-xs disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={runSuppressInactive}
                    disabled={cleaning}
                    className="btn-pib-accent text-xs disabled:opacity-50"
                  >
                    {cleaning ? 'Suppressing…' : 'Confirm suppress'}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section>
            <h2 className="font-display text-xl mb-3">Breakdown</h2>
            <BucketGrid breakdown={report.breakdown} />
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
              {report.breakdown.total.toLocaleString()} contacts total.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl mb-3">Suggested actions</h2>
            <div className="space-y-3">
              {report.suggestedActions.map((a) => (
                <div key={a.code} className="bento-card !p-4">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">{a.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl mb-3">Cleaning history</h2>
            <HistoryTable history={report.cleaningHistory} />
          </section>
        </>
      ) : null}
    </div>
  )
}
