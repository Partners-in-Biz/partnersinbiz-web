'use client'

import { useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import type { CompetitorComparison, TrackedCompetitor } from '@/lib/seo/competitors'

const MAX = 5
const BARS = ['var(--color-pib-accent)', '#60a5fa', '#34d399', '#f472b6', '#fbbf24']

export function CompetitorsClient({
  sprints,
  activeSprintId,
  clientSiteUrl,
  initialCompetitors,
}: {
  sprints: SprintOption[]
  activeSprintId?: string
  clientSiteUrl: string
  initialCompetitors: TrackedCompetitor[]
}) {
  const [competitors, setCompetitors] = useState<TrackedCompetitor[]>(initialCompetitors)
  const [comparison, setComparison] = useState<CompetitorComparison | null>(null)
  const [domain, setDomain] = useState('')
  const [adding, setAdding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function add() {
    if (!activeSprintId || !domain.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/v1/seo/competitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId, domain: domain.trim() }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      setCompetitors((prev) => [
        ...prev,
        { id: json.data.id, domain: domain.trim().replace(/^https?:\/\//, '').replace(/^www\./, ''), metrics: { domainAuthority: null, estimatedKeywords: 0, referringDomains: 0, overlapKeywords: [] }, lastRefreshedAt: null },
      ])
      setDomain('')
      showToast('Competitor added — hit Refresh to pull metrics')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add competitor')
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/v1/seo/competitors/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      setCompetitors((prev) => prev.filter((c) => c.id !== id))
      setComparison((prev) => (prev ? { ...prev, competitors: prev.competitors.filter((c) => c.id !== id) } : prev))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove competitor')
    }
  }

  async function refresh() {
    if (!activeSprintId) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/v1/seo/competitors/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      const data = json.data as CompetitorComparison
      setComparison(data)
      setCompetitors(data.competitors)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to refresh competitors')
    } finally {
      setRefreshing(false)
    }
  }

  const allOverlapDomains = comparison ? comparison.competitors.map((c) => c.domain) : competitors.map((c) => c.domain)
  const maxKeywords = Math.max(1, ...competitors.map((c) => c.metrics.estimatedKeywords))

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Competitive SEO"
        title="Competitor tracker"
        description={`Track up to ${MAX} competitor domains. Compare domain authority, keyword footprint, backlinks and keyword overlap against ${clientSiteUrl || 'your site'}.`}
        sprints={sprints}
        activeSprintId={activeSprintId}
        action={
          <button onClick={refresh} disabled={refreshing || competitors.length === 0 || !activeSprintId} className="pib-btn-secondary text-sm disabled:opacity-40">
            <span className={`material-symbols-outlined text-[18px] ${refreshing ? 'animate-spin' : ''}`}>{refreshing ? 'autorenew' : 'refresh'}</span>
            {refreshing ? 'Refreshing…' : 'Refresh metrics'}
          </button>
        }
      />

      {!activeSprintId ? (
        <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          No active SEO sprint. Create a sprint to track competitors.
        </div>
      ) : (
        <>
          {/* Add competitor */}
          <section className="pib-card-section">
            <div className="pib-card-section-header">
              <h3 className="text-sm font-semibold">Tracked competitors ({competitors.length}/{MAX})</h3>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Add a competitor domain. Metrics populate when you refresh.</p>
            </div>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="pib-label" htmlFor="dom">Competitor domain</label>
                <input
                  id="dom"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                  placeholder="competitor.com"
                  className="pib-input"
                  disabled={adding || competitors.length >= MAX}
                />
              </div>
              <button onClick={add} disabled={adding || !domain.trim() || competitors.length >= MAX} className="pib-btn-primary text-sm disabled:opacity-40">
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add
              </button>
            </div>
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                {competitors.map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-1.5 text-xs">
                    {c.domain}
                    <button onClick={() => remove(c.id)} className="text-[var(--color-pib-text-muted)] hover:text-red-300" aria-label={`Remove ${c.domain}`}>
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Per-competitor metrics */}
          {competitors.length > 0 && (
            <section className="pib-card-section overflow-hidden">
              <div className="pib-card-section-header">
                <h3 className="text-sm font-semibold">Metrics comparison</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Domain authority, on-page keyword footprint and referring domains per competitor.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                      <th className="px-5 py-3 eyebrow !text-[10px]">Domain</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">DA</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Keywords</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Ref. domains</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Overlap</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Last refreshed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-pib-line)]">
                    {comparison && (
                      <tr className="bg-[var(--color-pib-accent-soft)]">
                        <td className="px-5 py-3 font-semibold">{comparison.clientDomain} <span className="pib-pill pib-pill-accent text-[10px] ml-1">You</span></td>
                        <td className="px-5 py-3 text-right tabular-nums">{comparison.clientDomainAuthority != null ? comparison.clientDomainAuthority.toFixed(0) : '—'}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{comparison.clientKeywordCount}</td>
                        <td className="px-5 py-3 text-right tabular-nums">—</td>
                        <td className="px-5 py-3 text-right tabular-nums">—</td>
                        <td className="px-5 py-3 text-xs text-[var(--color-pib-text-muted)]">—</td>
                      </tr>
                    )}
                    {competitors.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--color-pib-surface-2)]">
                        <td className="px-5 py-3 font-medium">{c.domain}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{c.metrics.domainAuthority != null ? c.metrics.domainAuthority.toFixed(0) : '—'}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{c.metrics.estimatedKeywords || '—'}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{c.metrics.referringDomains || '—'}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{c.metrics.overlapKeywords.length || '—'}</td>
                        <td className="px-5 py-3 text-xs text-[var(--color-pib-text-muted)]">{c.lastRefreshedAt ? c.lastRefreshedAt.slice(0, 10) : 'Not yet'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Keyword footprint chart */}
          {competitors.some((c) => c.metrics.estimatedKeywords > 0) && (
            <section className="pib-card-section">
              <div className="pib-card-section-header">
                <h3 className="text-sm font-semibold">Keyword footprint</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Relative on-page keyword coverage per competitor.</p>
              </div>
              <div className="space-y-3 p-4">
                {competitors.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="w-40 truncate text-xs">{c.domain}</span>
                    <span className="flex-1 h-3 rounded-full bg-white/10 overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${(c.metrics.estimatedKeywords / maxKeywords) * 100}%`, background: BARS[i % BARS.length] }} />
                    </span>
                    <span className="w-12 text-right text-xs tabular-nums">{c.metrics.estimatedKeywords}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Rank-comparison / overlap matrix */}
          {comparison && comparison.overlapMatrix.length > 0 && (
            <section className="pib-card-section overflow-hidden">
              <div className="pib-card-section-header">
                <h3 className="text-sm font-semibold">Keyword overlap & rank comparison</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Your tracked keywords also covered by competitors. ✓ = competitor targets this term.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                      <th className="px-5 py-3 eyebrow !text-[10px]">Keyword</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Your position</th>
                      {allOverlapDomains.map((d) => (
                        <th key={d} className="px-5 py-3 eyebrow !text-[10px] text-center max-w-[120px] truncate">{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-pib-line)]">
                    {comparison.overlapMatrix.map((row) => (
                      <tr key={row.keyword} className="hover:bg-[var(--color-pib-surface-2)]">
                        <td className="px-5 py-3 font-medium">{row.keyword}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{row.clientPosition != null ? `#${row.clientPosition.toFixed(0)}` : 'Not ranking'}</td>
                        {allOverlapDomains.map((d) => (
                          <td key={d} className="px-5 py-3 text-center">
                            {row.coveredBy.includes(d) ? <span className="material-symbols-outlined text-[16px] text-emerald-300">check</span> : <span className="text-[var(--color-pib-text-muted)]">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}
