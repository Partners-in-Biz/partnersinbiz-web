'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

interface ReferrerEntry {
  label: string
  count: number
}

interface AnalyticsArticle {
  id: string
  title: string
  slug: string
  status: string
  views: number
  sessions: number
  bounceRate: number
  topReferrers: ReferrerEntry[]
  socialShares: number
  keyword: string
  keywordPosition: number | null
}

interface AnalyticsSeriesPoint {
  date: string
  views: number
}

interface AnalyticsResponse {
  range: { from: string; to: string }
  hasProperty: boolean
  articles: AnalyticsArticle[]
  series: AnalyticsSeriesPoint[]
  totals: { views: number; sessions: number }
}

type SortKey = 'views' | 'sessions' | 'bounce'
type SortDir = 'asc' | 'desc'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function shortDate(iso: string): string {
  // Expecting YYYY-MM-DD; fall back to slicing.
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (m) return `${m[2]}-${m[3]}`
  return iso.slice(5, 10) || iso
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'published' || s === 'live') return 'bg-green-500/10 text-green-400'
  if (s === 'draft') return 'bg-amber-500/10 text-amber-400'
  return 'bg-on-surface/10 text-on-surface-variant'
}

function csvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export default function ContentAnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [propertyId, setPropertyId] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('views')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const load = useCallback(async (pid: string) => {
    setLoading(true)
    setError(null)
    try {
      const qs = pid.trim() ? `?propertyId=${encodeURIComponent(pid.trim())}` : ''
      const res = await fetch(`/api/v1/admin/content/analytics${qs}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load content analytics')
        setData(null)
      } else {
        setData((body.data ?? null) as AnalyticsResponse | null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content analytics')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load only; subsequent loads are triggered explicitly on propertyId apply.
  useEffect(() => {
    load('')
  }, [load])

  const articles = data?.articles ?? []

  const avgBounce = useMemo(() => {
    if (articles.length === 0) return 0
    const sum = articles.reduce((acc, a) => acc + (Number.isFinite(a.bounceRate) ? a.bounceRate : 0), 0)
    return Math.round((sum / articles.length) * 10) / 10
  }, [articles])

  const sortedArticles = useMemo(() => {
    const field: Record<SortKey, (a: AnalyticsArticle) => number> = {
      views: (a) => a.views,
      sessions: (a) => a.sessions,
      bounce: (a) => a.bounceRate,
    }
    const get = field[sortKey]
    const dir = sortDir === 'asc' ? 1 : -1
    return [...articles].sort((a, b) => (get(a) - get(b)) * dir)
  }, [articles, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function sortArrow(key: SortKey): string {
    if (key !== sortKey) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  function exportCsv() {
    const headers = [
      'Title',
      'Slug',
      'Status',
      'Keyword',
      'Position',
      'Views',
      'Sessions',
      'Bounce%',
      'Shares',
      'TopReferrer',
    ]
    const rows = articles.map((a) =>
      [
        csvCell(a.title),
        csvCell(a.slug),
        csvCell(a.status),
        csvCell(a.keyword),
        csvCell(a.keywordPosition),
        csvCell(a.views),
        csvCell(a.sessions),
        csvCell(a.bounceRate),
        csvCell(a.socialShares),
        csvCell(a.topReferrers[0]?.label ?? ''),
      ].join(','),
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'content-analytics.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const series = data?.series ?? []

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Content / Analytics
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Content Analytics</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Traffic, engagement, and keyword performance for your published articles over the last 30 days.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 self-start md:self-auto">
          <label className="block">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
              Property ID
            </span>
            <input
              type="text"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load(propertyId)
              }}
              onBlur={() => load(propertyId)}
              placeholder="optional"
              className="pib-input mt-1 w-40 font-mono text-sm"
            />
          </label>
          <button
            onClick={exportCsv}
            disabled={articles.length === 0}
            className="pib-btn-secondary text-sm font-label"
          >
            Export CSV
          </button>
          <Link href="/admin/content/seo" className="pib-btn-ghost text-sm font-label">
            Articles
          </Link>
        </div>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && data && !data.hasProperty && (
        <div className="pib-card flex items-center gap-2 px-4 py-3 text-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-base">info</span>
          <span>
            No analytics property connected — metrics show zero. Enter a propertyId to join live traffic.
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Total views
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">
                {(data?.totals.views ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Total sessions
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">
                {(data?.totals.sessions ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Tracked articles
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{articles.length}</p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Avg bounce rate
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{avgBounce}%</p>
            </div>
          </div>

          <div className="pib-card p-5">
            <p className="text-sm font-headline font-bold text-on-surface mb-3">Traffic — last 30 days</p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent-v2)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-accent-v2)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-card-border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }}
                    stroke="var(--color-card-border)"
                  />
                  <YAxis
                    allowDecimals={false}
                    width={40}
                    tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }}
                    stroke="var(--color-card-border)"
                  />
                  <Tooltip
                    labelFormatter={(label) => shortDate(String(label))}
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-card-border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="var(--color-accent-v2)"
                    strokeWidth={2}
                    fill="url(#trafficFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {articles.length === 0 ? (
            <div className="pib-card p-8 text-center">
              <p className="text-sm text-on-surface-variant">No article analytics yet.</p>
              <p className="text-xs text-on-surface-variant/60 mt-1">
                Publish articles and connect an analytics property to start tracking traffic and engagement.
              </p>
            </div>
          ) : (
            <div className="pib-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-card-border)] text-left">
                    <th className="px-4 py-3 font-label text-[10px] uppercase tracking-wide text-on-surface-variant">
                      Title
                    </th>
                    <th className="px-4 py-3 font-label text-[10px] uppercase tracking-wide text-on-surface-variant">
                      Status
                    </th>
                    <th className="px-4 py-3 font-label text-[10px] uppercase tracking-wide text-on-surface-variant">
                      Keyword
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort('views')}
                        className="font-label text-[10px] uppercase tracking-wide text-on-surface-variant hover:text-on-surface"
                      >
                        Views{sortArrow('views')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort('sessions')}
                        className="font-label text-[10px] uppercase tracking-wide text-on-surface-variant hover:text-on-surface"
                      >
                        Sessions{sortArrow('sessions')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort('bounce')}
                        className="font-label text-[10px] uppercase tracking-wide text-on-surface-variant hover:text-on-surface"
                      >
                        Bounce %{sortArrow('bounce')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-label text-[10px] uppercase tracking-wide text-on-surface-variant">
                      Shares
                    </th>
                    <th className="px-4 py-3 font-label text-[10px] uppercase tracking-wide text-on-surface-variant">
                      Top referrer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedArticles.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-[var(--color-card-border)] last:border-0 hover:bg-on-surface/5"
                    >
                      <td className="px-4 py-3 max-w-xs">
                        <p className="font-medium text-on-surface truncate">{a.title}</p>
                        <p className="text-[11px] text-on-surface-variant font-mono truncate">/{a.slug}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${statusBadgeClass(
                            a.status,
                          )}`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {a.keyword ? (
                          <span>
                            {a.keyword}
                            {a.keywordPosition !== null && (
                              <span className="text-[11px] text-on-surface-variant/70">
                                {' '}
                                #{a.keywordPosition}
                              </span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-on-surface tabular-nums">
                        {a.views.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-on-surface tabular-nums">
                        {a.sessions.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-on-surface tabular-nums">
                        {a.bounceRate}%
                      </td>
                      <td className="px-4 py-3 text-right text-on-surface tabular-nums">
                        {a.socialShares.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {a.topReferrers[0]?.label ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
