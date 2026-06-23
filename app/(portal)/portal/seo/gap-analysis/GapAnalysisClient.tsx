'use client'

import { useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { downloadText } from '@/components/seo/seoToolClient'
import { toCsv } from '@/lib/seo/csv'
import { scopedPortalHref, type PortalSeoScope } from '../portalSeoScopeShared'
import type { GapAnalysisResult } from '@/lib/seo/gap-analysis'

const INTENT_COLORS: Record<string, string> = {
  solution: 'pib-pill-success',
  problem: 'pib-pill-warn',
  informational: 'pib-pill-info',
  brand: '',
}

export function GapAnalysisClient({
  sprints,
  activeSprintId,
  scope,
}: {
  sprints: SprintOption[]
  activeSprintId?: string
  scope: PortalSeoScope
}) {
  const [competitor, setCompetitor] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GapAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runAnalysis() {
    if (!activeSprintId || !competitor.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/v1/seo/gap-analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId, competitorDomain: competitor.trim() }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      setResult(json.data as GapAnalysisResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap analysis failed')
    } finally {
      setLoading(false)
    }
  }

  function exportCsv() {
    if (!result) return
    const rows = result.gaps.map((g) => ({
      keyword: g.keyword,
      opportunityScore: g.opportunityScore,
      intent: g.intent,
      clientRanks: g.clientRanks ? 'yes' : 'no',
      clientPosition: g.clientPosition ?? '',
      competitorMentions: g.competitorMentions,
    }))
    const csv = toCsv(rows, [
      { key: 'keyword', label: 'Keyword' },
      { key: 'opportunityScore', label: 'Opportunity Score' },
      { key: 'intent', label: 'Intent' },
      { key: 'clientRanks', label: 'Client Ranks' },
      { key: 'clientPosition', label: 'Client Position' },
      { key: 'competitorMentions', label: 'Competitor Mentions' },
    ])
    downloadText(`gap-analysis-${result.competitorDomain}.csv`, csv)
  }

  function briefHref(keyword: string) {
    const base = scopedPortalHref('/portal/seo/briefs', scope)
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}keyword=${encodeURIComponent(keyword)}&competitor=${encodeURIComponent(result?.competitorDomain ?? '')}`
  }

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Competitive SEO"
        title="Content gap analysis"
        description="Crawl a competitor domain to find the keywords they target that you don't yet rank for, scored by opportunity. Turn any gap into a content brief."
        sprints={sprints}
        activeSprintId={activeSprintId}
      />

      <section className="pib-card-section">
        <div className="pib-card-section-header">
          <h3 className="text-sm font-semibold">Competitor domain</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Enter a competitor&apos;s domain. We crawl their top pages and compare topics to your tracked keywords.</p>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="pib-label" htmlFor="competitor">Domain</label>
            <input
              id="competitor"
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
              placeholder="competitor.com"
              className="pib-input"
              disabled={loading}
            />
          </div>
          <button onClick={runAnalysis} disabled={loading || !activeSprintId || !competitor.trim()} className="pib-btn-primary text-sm disabled:opacity-40">
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">autorenew</span>
                Analysing…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">travel_explore</span>
                Run analysis
              </>
            )}
          </button>
        </div>
        {!activeSprintId && (
          <p className="px-4 pb-4 text-xs text-[var(--color-pib-text-muted)]">No active SEO sprint. Create a sprint to run gap analysis.</p>
        )}
        {error && (
          <p className="px-4 pb-4 flex items-center gap-1.5 text-xs text-red-300">
            <span className="material-symbols-outlined text-sm">error</span>
            {error}
          </p>
        )}
      </section>

      {result && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Gap keywords" value={result.gaps.length.toString()} icon="lightbulb" />
            <StatCard label="Pages analysed" value={result.pagesAnalyzed.toString()} icon="description" />
            <StatCard label="Overlap" value={result.overlap.length.toString()} icon="join_inner" />
            <StatCard label="Your tracked KWs" value={result.clientKeywordCount.toString()} icon="format_list_numbered" />
          </section>

          <section className="pib-card-section overflow-hidden">
            <div className="pib-card-section-header flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Gap keywords for {result.competitorDomain}</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">
                  Keywords {result.competitorDomain} covers that you don&apos;t rank well for. {result.generatedBy === 'ai' ? 'Refined with AI.' : 'Heuristic extraction.'}
                </p>
              </div>
              <button onClick={exportCsv} disabled={result.gaps.length === 0} className="pib-btn-secondary text-sm disabled:opacity-40">
                <span className="material-symbols-outlined text-[18px]">download</span>
                Export CSV
              </button>
            </div>
            {result.gaps.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No gaps found — you already cover this competitor&apos;s topics.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                      <th className="px-5 py-3 eyebrow !text-[10px]">Keyword</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Intent</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Opportunity</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]">Your status</th>
                      <th className="px-5 py-3 eyebrow !text-[10px] text-right">Mentions</th>
                      <th className="px-5 py-3 eyebrow !text-[10px]"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-pib-line)]">
                    {result.gaps.map((g) => (
                      <tr key={g.keyword} className="hover:bg-[var(--color-pib-surface-2)]">
                        <td className="px-5 py-3 font-medium">{g.keyword}</td>
                        <td className="px-5 py-3">
                          <span className={`pib-pill text-[10px] ${INTENT_COLORS[g.intent] ?? ''}`}>{g.intent}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <span className="tabular-nums font-semibold">{g.opportunityScore}</span>
                            <span className="h-1.5 w-16 rounded-full bg-white/10 overflow-hidden">
                              <span className="block h-full rounded-full bg-[var(--color-pib-accent)]" style={{ width: `${g.opportunityScore}%` }} />
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--color-pib-text-muted)]">
                          {g.clientRanks ? `Ranks #${g.clientPosition?.toFixed(0) ?? '?'}` : 'Not ranking'}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{g.competitorMentions}</td>
                        <td className="px-5 py-3 text-right">
                          <a href={briefHref(g.keyword)} className="pib-btn-secondary text-xs !py-1.5">
                            <span className="material-symbols-outlined text-[14px]">edit_document</span>
                            Brief
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none tracking-tight md:text-4xl">{value}</p>
    </div>
  )
}
