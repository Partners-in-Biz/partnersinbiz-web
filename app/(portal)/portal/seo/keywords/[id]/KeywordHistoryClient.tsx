'use client'

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { TrendChart } from '@/components/seo/TrendChart'
import { fetchSeo, downloadText } from '@/components/seo/seoToolClient'
import { toCsv } from '@/lib/seo/csv'
import type { SeoKeyword, KeywordPosition } from '@/lib/seo/types'

type SerializableKeyword = Omit<SeoKeyword, 'createdAt'> & { createdAt: string }
type AuditAnnotation = { id: string; snapshotDay: number; capturedAt: string }
type Sibling = { id: string; keyword: string }

const WINDOW_DAYS = 183

function filterLast183(positions: KeywordPosition[]): KeywordPosition[] {
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  return positions.filter((p) => new Date(p.pulledAt).getTime() >= cutoff)
}

function buildSharedAxis(a: KeywordPosition[], b: KeywordPosition[]): {
  dates: string[]
  aPoints: (number | null)[]
  bPoints: (number | null)[]
} {
  const allDates = Array.from(new Set([...a.map((p) => p.pulledAt.slice(0, 10)), ...b.map((p) => p.pulledAt.slice(0, 10))])).sort()
  const aMap = new Map(a.map((p) => [p.pulledAt.slice(0, 10), p.position]))
  const bMap = new Map(b.map((p) => [p.pulledAt.slice(0, 10), p.position]))
  return {
    dates: allDates,
    aPoints: allDates.map((d) => aMap.get(d) ?? null),
    bPoints: allDates.map((d) => bMap.get(d) ?? null),
  }
}

export function KeywordHistoryClient({
  keyword,
  siblings,
  audits,
}: {
  keyword: SerializableKeyword
  siblings: Sibling[]
  audits: AuditAnnotation[]
}) {
  const searchParams = useSearchParams()

  const [compareId, setCompareId] = useState('')
  const [comparePositions, setComparePositions] = useState<KeywordPosition[] | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  function buildBackHref() {
    const next = new URLSearchParams(Array.from(searchParams.entries()))
    return `/portal/seo/keywords?${next.toString()}`
  }

  useEffect(() => {
    if (!compareId) {
      setComparePositions(null)
      return
    }
    setLoadingCompare(true)
    fetchSeo<KeywordPosition[]>(`/api/v1/seo/keywords/${compareId}/positions`)
      .then((pos) => setComparePositions(pos))
      .catch((err) => showToast(err instanceof Error ? err.message : 'Failed to load compare data'))
      .finally(() => setLoadingCompare(false))
  }, [compareId])

  const windowedPositions = useMemo(() => filterLast183(keyword.positions ?? []), [keyword.positions])
  const windowedCompare = useMemo(
    () => (comparePositions ? filterLast183(comparePositions) : null),
    [comparePositions],
  )

  const { dates, aPoints, bPoints } = useMemo(() => {
    if (windowedCompare && windowedCompare.length > 0) {
      return buildSharedAxis(windowedPositions, windowedCompare)
    }
    return {
      dates: windowedPositions.map((p) => p.pulledAt.slice(0, 10)),
      aPoints: windowedPositions.map((p) => p.position),
      bPoints: [] as (number | null)[],
    }
  }, [windowedPositions, windowedCompare])

  const chartLabels = dates.map((d) => d.slice(5))

  const compareKw = siblings.find((s) => s.id === compareId)
  const series = [
    { label: keyword.keyword, points: aPoints },
    ...(windowedCompare && compareKw ? [{ label: compareKw.keyword, points: bPoints, color: '#60a5fa' }] : []),
  ]

  // Stats
  const validPoints = aPoints.filter((v): v is number => v !== null)
  const currentPos = validPoints.length ? validPoints[validPoints.length - 1] : null
  const bestPos = validPoints.length ? Math.min(...validPoints) : null
  const firstPos = validPoints.length ? validPoints[0] : null
  const periodChangePct =
    currentPos !== null && firstPos !== null && firstPos !== 0
      ? ((firstPos - currentPos) / firstPos) * 100
      : null
  const totalImpressions = (keyword.positions ?? []).reduce((s, p) => s + (p.impressions ?? 0), 0)
  const totalClicks = (keyword.positions ?? []).reduce((s, p) => s + (p.clicks ?? 0), 0)

  function handleExportCsv() {
    const rows = (keyword.positions ?? []).map((p) => ({
      pulledAt: p.pulledAt,
      position: p.position,
      impressions: p.impressions ?? '',
      clicks: p.clicks ?? '',
      ctr: p.ctr != null ? (p.ctr * 100).toFixed(2) + '%' : '',
    }))
    const csv = toCsv(rows, [
      { key: 'pulledAt', label: 'Date' },
      { key: 'position', label: 'Position' },
      { key: 'impressions', label: 'Impressions' },
      { key: 'clicks', label: 'Clicks' },
      { key: 'ctr', label: 'CTR' },
    ])
    downloadText(`keyword-history-${keyword.id}.csv`, csv)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-[var(--color-pib-line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <a href={buildBackHref()} className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] mb-2">
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Back to keywords
          </a>
          <p className="eyebrow">Keyword history</p>
          <h1 className="mt-2 font-headline text-2xl font-semibold md:text-3xl">{keyword.keyword}</h1>
          {keyword.targetPageUrl && (
            <a
              href={keyword.targetPageUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[12px]">link</span>
              {keyword.targetPageUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
        <button onClick={handleExportCsv} disabled={(keyword.positions ?? []).length === 0} className="pib-btn-secondary text-sm self-start sm:self-auto disabled:opacity-40">
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export CSV
        </button>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Current position" value={currentPos != null ? `#${currentPos.toFixed(1)}` : '—'} icon="format_list_numbered" />
        <StatCard label="Best position" value={bestPos != null ? `#${bestPos.toFixed(1)}` : '—'} icon="emoji_events" />
        <StatCard
          label="6-month change"
          value={periodChangePct != null ? `${periodChangePct > 0 ? '+' : ''}${periodChangePct.toFixed(1)}%` : '—'}
          icon="trending_up"
          highlight={periodChangePct != null ? (periodChangePct > 0 ? 'good' : 'bad') : undefined}
        />
        <StatCard label="Total clicks (all time)" value={totalClicks.toLocaleString('en-ZA')} icon="ads_click" />
      </section>

      {/* Chart */}
      <section className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Position history — last 6 months</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Lower position = higher on Google. Chart is flipped so improvements go up.</p>
          </div>
          <div className="flex items-center gap-2">
            {siblings.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="pib-label !mb-0 text-xs">Compare to</label>
                <select
                  value={compareId}
                  onChange={(e) => setCompareId(e.target.value)}
                  className="pib-select !w-auto text-xs"
                  disabled={loadingCompare}
                >
                  <option value="">— none —</option>
                  {siblings.map((s) => (
                    <option key={s.id} value={s.id}>{s.keyword}</option>
                  ))}
                </select>
                {loadingCompare && <span className="material-symbols-outlined animate-spin text-[16px] text-[var(--color-pib-text-muted)]">autorenew</span>}
              </div>
            )}
          </div>
        </div>
        <div className="p-4">
          {chartLabels.length < 2 ? (
            <div className="flex items-center justify-center rounded-xl border border-[var(--color-pib-line)] bg-black/10 text-xs text-[var(--color-pib-text-muted)]" style={{ height: 240 }}>
              Not enough position data yet. Data appears after Search Console pulls.
            </div>
          ) : (
            <TrendChart
              labels={chartLabels}
              series={series}
              height={240}
              reverseY={true}
              zeroBased={false}
              yFormat={(v) => `#${v.toFixed(0)}`}
            />
          )}
        </div>
      </section>

      {/* Audit annotations */}
      {audits.length > 0 && (
        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <h3 className="text-sm font-semibold">Sprint audit snapshots</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Dates when audit snapshots were captured for this sprint.</p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {audits
              .sort((a, b) => a.snapshotDay - b.snapshotDay)
              .map((audit) => (
                <div key={audit.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <span className="pib-pill text-[10px] shrink-0">Day {audit.snapshotDay}</span>
                  <span className="text-[var(--color-pib-text-muted)]">{audit.capturedAt.slice(0, 10)}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Position history table */}
      <section className="pib-card-section overflow-hidden">
        <div className="pib-card-section-header">
          <h3 className="text-sm font-semibold">Full position history</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">All recorded position data points from Search Console pulls.</p>
        </div>
        {(keyword.positions ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No positions recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                  <th className="px-5 py-3 eyebrow !text-[10px]">Date</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Position</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Impressions</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Clicks</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">CTR</th>
                  <th className="px-5 py-3 eyebrow !text-[10px]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {[...(keyword.positions ?? [])]
                  .sort((a, b) => new Date(b.pulledAt).getTime() - new Date(a.pulledAt).getTime())
                  .map((p, i) => (
                    <tr key={i} className="hover:bg-[var(--color-pib-surface-2)]">
                      <td className="px-5 py-3 tabular-nums">{p.pulledAt.slice(0, 10)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">#{p.position.toFixed(1)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{p.impressions?.toLocaleString('en-ZA') ?? '—'}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{p.clicks?.toLocaleString('en-ZA') ?? '—'}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{p.ctr != null ? `${(p.ctr * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-5 py-3">
                        <span className="pib-pill text-[10px]">{p.source}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string
  value: string
  icon: string
  highlight?: 'good' | 'bad'
}) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p
        className={`mt-3 font-display text-3xl leading-none tracking-tight md:text-4xl ${
          highlight === 'good' ? 'text-emerald-300' : highlight === 'bad' ? 'text-red-300' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}
