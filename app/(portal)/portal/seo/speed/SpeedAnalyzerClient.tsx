'use client'

import { useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { TrendChart } from '@/components/seo/TrendChart'
import { fetchSeo } from '@/components/seo/seoToolClient'
import type { PerformanceResult } from '@/lib/seo/performance'

type HistoricalRun = {
  id: string
  url: string
  strategy: string
  score: number
  lcp?: number
  cls?: number
  inp?: number
  ttfb?: number
  ranAt: string
}

type Props = {
  sprints: SprintOption[]
  activeSprintId?: string
  defaultUrl: string
  historicalRuns: HistoricalRun[]
}

function fmtMs(ms: number | undefined) {
  if (ms === undefined) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function fmtCls(cls: number | undefined) {
  if (cls === undefined) return '-'
  return cls.toFixed(3)
}

function scoreColor(score: number) {
  if (score >= 80) return '#34d399'
  if (score >= 50) return '#fbbf24'
  return '#f87171'
}

function MetricCard({ label, value, icon, subtext, ok }: { label: string; value: string; icon: string; subtext?: string; ok?: boolean }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p
        className="mt-3 font-display text-3xl leading-none tracking-tight md:text-4xl tabular-nums"
        style={{ color: ok !== undefined ? (ok ? '#34d399' : '#f87171') : undefined }}
      >
        {value}
      </p>
      {subtext && <p className="mt-2 text-[11px] text-[var(--color-pib-text-muted)]">{subtext}</p>}
    </div>
  )
}

export function SpeedAnalyzerClient({ sprints, activeSprintId, defaultUrl, historicalRuns }: Props) {
  const [urls, setUrls] = useState([defaultUrl, '', ''])
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<PerformanceResult[]>([])

  const activeUrls = urls.filter((u) => u.trim() !== '')

  async function analyse() {
    if (activeUrls.length === 0) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const payload =
        activeUrls.length === 1
          ? { url: activeUrls[0], strategy, sprintId: activeSprintId }
          : { urls: activeUrls, strategy, sprintId: activeSprintId }
      const data = await fetchSeo<PerformanceResult | PerformanceResult[]>(
        '/api/v1/seo/performance-check',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      setResults(Array.isArray(data) ? data : [data])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const singleResult = results.length === 1 ? results[0] : null
  const multiCompare = results.length > 1

  // Historical trend: filter by mobile, sort by ranAt asc, last 20
  const trendRuns = [...historicalRuns]
    .filter((r) => r.strategy === 'mobile')
    .sort((a, b) => a.ranAt.localeCompare(b.ranAt))
    .slice(-20)
  const trendLabels = trendRuns.map((r) =>
    new Date(r.ranAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
  )
  const trendScores = trendRuns.map((r) => r.score)

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Performance"
        title="Speed Analyzer"
        description="PageSpeed Insights metrics with opportunities, trend history, and multi-URL comparison."
        sprints={sprints}
        activeSprintId={activeSprintId}
      />

      {/* Input card */}
      <div className="pib-card p-6 space-y-4">
        <div className="grid grid-cols-1 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              {i === 0 && <label className="pib-label">URL {i + 1} (required)</label>}
              {i > 0 && <label className="pib-label text-[var(--color-pib-text-muted)]">URL {i + 1} (optional — compare)</label>}
              <input
                type="url"
                className="pib-input w-full"
                placeholder={i === 0 ? 'https://example.com' : 'https://example.com/page-2 (optional)'}
                value={urls[i]}
                onChange={(e) => {
                  const next = [...urls]
                  next[i] = e.target.value
                  setUrls(next)
                }}
                disabled={loading}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="pib-label">Strategy</label>
            <select
              className="pib-select !w-auto text-sm"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as 'mobile' | 'desktop')}
              disabled={loading}
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
            </select>
          </div>
          <button
            onClick={analyse}
            disabled={activeUrls.length === 0 || loading}
            className="pib-btn-primary text-sm disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              {loading ? 'autorenew' : 'speed'}
            </span>
            {loading ? 'Analysing…' : activeUrls.length > 1 ? `Analyse ${activeUrls.length} URLs` : 'Analyse'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">error</span>
          {error}
        </div>
      )}

      {/* Single result */}
      {singleResult && !multiCompare && (
        <>
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <MetricCard
              label="Performance"
              value={`${singleResult.score}`}
              icon="speed"
              subtext={singleResult.score >= 75 ? 'Good' : singleResult.score >= 50 ? 'Needs work' : 'Poor'}
              ok={singleResult.score >= 75}
            />
            <MetricCard
              label="LCP"
              value={fmtMs(singleResult.lcp)}
              icon="image"
              subtext={singleResult.lcp ? (singleResult.lcp <= 2500 ? 'Good' : singleResult.lcp <= 4000 ? 'Needs work' : 'Poor') : undefined}
              ok={singleResult.lcp !== undefined ? singleResult.lcp <= 2500 : undefined}
            />
            <MetricCard
              label="CLS"
              value={fmtCls(singleResult.cls)}
              icon="straighten"
              subtext={singleResult.cls !== undefined ? (singleResult.cls <= 0.1 ? 'Good' : singleResult.cls <= 0.25 ? 'Needs work' : 'Poor') : undefined}
              ok={singleResult.cls !== undefined ? singleResult.cls <= 0.1 : undefined}
            />
            <MetricCard
              label="INP"
              value={fmtMs(singleResult.inp)}
              icon="touch_app"
              subtext={singleResult.inp ? (singleResult.inp <= 200 ? 'Good' : singleResult.inp <= 500 ? 'Needs work' : 'Poor') : undefined}
              ok={singleResult.inp !== undefined ? singleResult.inp <= 200 : undefined}
            />
            <MetricCard
              label="TTFB"
              value={fmtMs(singleResult.ttfb)}
              icon="timer"
              subtext={singleResult.ttfb ? (singleResult.ttfb <= 800 ? 'Good' : 'Slow') : undefined}
              ok={singleResult.ttfb !== undefined ? singleResult.ttfb <= 800 : undefined}
            />
          </section>

          {singleResult.opportunities.length > 0 && (
            <section className="pib-card-section">
              <div className="pib-card-section-header">
                <h3 className="text-sm font-semibold">Opportunities</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Sorted by estimated savings, descending.</p>
              </div>
              <div className="divide-y divide-[var(--color-pib-line)]">
                {singleResult.opportunities.map((opp) => (
                  <div key={opp.id} className="flex items-start gap-4 px-5 py-4">
                    <span className="material-symbols-outlined text-[20px] text-amber-400 flex-shrink-0 mt-0.5">bolt</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{opp.title}</p>
                        <span className="pib-pill text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-300">
                          -{fmtMs(opp.savingsMs)}
                        </span>
                      </div>
                      {opp.description && (
                        <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)] line-clamp-2">{opp.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Multi-URL comparison */}
      {multiCompare && (
        <section className="pib-card-section overflow-hidden">
          <div className="pib-card-section-header">
            <h3 className="text-sm font-semibold">URL Comparison</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">{strategy} strategy</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                  <th className="px-5 py-3 eyebrow !text-[10px]">URL</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Score</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">LCP</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">CLS</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">INP</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">TTFB</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {results.map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--color-pib-surface-2)]">
                    <td className="px-5 py-3 max-w-xs truncate text-xs">
                      <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-pib-accent)]">
                        {r.url.replace(/^https?:\/\//, '')}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold" style={{ color: scoreColor(r.score) }}>
                      {r.score}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-xs">{fmtMs(r.lcp)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-xs">{fmtCls(r.cls)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-xs">{fmtMs(r.inp)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-xs">{fmtMs(r.ttfb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Historical trend chart */}
      {trendRuns.length > 1 && (
        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <h3 className="text-sm font-semibold">Performance trend</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Mobile performance score over recent runs.</p>
          </div>
          <div className="p-4">
            <TrendChart
              labels={trendLabels}
              series={[{ label: 'Performance score', points: trendScores, color: '#34d399' }]}
              height={200}
              zeroBased={false}
              yFormat={(v) => `${Math.round(v)}`}
            />
          </div>
        </section>
      )}

      {trendRuns.length === 0 && results.length === 0 && !loading && (
        <div className="pib-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">speed</span>
          <h3 className="font-headline text-lg font-semibold mt-3">No runs yet</h3>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">
            Enter a URL above and click Analyse to see PageSpeed metrics.
          </p>
        </div>
      )}
    </div>
  )
}
