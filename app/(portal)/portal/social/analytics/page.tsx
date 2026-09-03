'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'
import { HorizontalBarChart, DonutChart, TrendAreaChart } from '@/components/ui/Charts'
import { PageHeader, PageTabs } from '@/components/ui/AppFoundation'

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface AnalyticsSnapshot {
  id: string
  postId: string
  platform: string
  platformPostId: string
  snapshotType: string
  metrics: {
    impressions: number
    reach: number
    engagements: number
    likes: number
    comments: number
    shares: number
    saves: number
    clicks: number
    profileVisits: number | null
    videoViews: number | null
  }
  collectedAt: any
}

interface PostData {
  id: string
  content: string | { text: string }
  platforms?: string[]
  platform?: string
  status: string
  publishedAt: any
  scheduledFor: any
  createdAt: any
  platformResults?: Record<string, any>
}

interface BestTimeSlot {
  dayOfWeek: number
  hour: number
  avgScore: number
  postCount: number
}

interface SocialReport {
  id: string
  title: string
  dateRange?: { from: string | null; to: string | null; label?: string }
  generatedBy?: string
  createdAt?: any
  metricsSummary?: Record<string, number>
}

const PLATFORM_COLORS: Record<string, { bg: string; label: string }> = {
  twitter: { bg: 'bg-black', label: 'X' },
  x: { bg: 'bg-black', label: 'X' },
  linkedin: { bg: 'bg-blue-700', label: 'LI' },
  facebook: { bg: 'bg-blue-600', label: 'FB' },
  instagram: { bg: 'bg-pink-600', label: 'IG' },
  reddit: { bg: 'bg-orange-600', label: 'RD' },
  tiktok: { bg: 'bg-gray-800', label: 'TT' },
  pinterest: { bg: 'bg-red-700', label: 'PI' },
  bluesky: { bg: 'bg-sky-500', label: 'BS' },
  threads: { bg: 'bg-gray-700', label: 'TH' },
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type DateRange = '7d' | '30d' | 'all'
type Tab = 'overview' | 'posts' | 'best-times'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getPostText(post: PostData): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: PostData): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function fmtDate(ts: any) {
  const d = tsToDate(ts)
  return d ? d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ' - '
}

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

/* ------------------------------------------------------------------ */
/*  Small components                                                   */
/* ------------------------------------------------------------------ */

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORM_COLORS[platform.toLowerCase()]
  if (!cfg) return <span className="pib-pill uppercase">{platform}</span>
  return <span className={`${cfg.bg} text-white text-[10px] px-2 py-0.5 rounded `}>{cfg.label}</span>
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="pib-stat-card p-3" data-module-accent="rose">
      <p className="pib-label mb-1 text-[10px] tracking-[0.14em]">{label}</p>
      <p className="text-xl tabular-nums tracking-tight text-[var(--color-pib-text)]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>}
    </div>
  )
}

function HeatCell({ value, max }: { value: number; max: number }) {
  const intensity = max > 0 ? Math.round((value / max) * 100) : 0
  const bg = value > 0 ? `color-mix(in srgb, var(--st-danger) ${Math.round(intensity * 0.7)}%, transparent)` : 'transparent'
  return (
    <div
      className="w-8 h-8 rounded flex items-center justify-center text-[9px] font-medium text-[var(--color-pib-text-muted)]"
      style={{ backgroundColor: bg }}
      title={`Score: ${value}`}
    >
      {value > 0 ? value : ''}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const { orgId } = useOrg()
  const [posts, setPosts] = useState<PostData[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot[]>([])
  const [bestTimes, setBestTimes] = useState<BestTimeSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<DateRange>('30d')
  const [tab, setTab] = useState<Tab>('overview')
  const [reports, setReports] = useState<SocialReport[]>([])
  const [generating, setGenerating] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [postsRes, analyticsRes, bestTimesRes] = await Promise.all([
        fetch(`/api/v1/social/posts?status=published&limit=100${orgId ? `&orgId=${orgId}` : ''}`),
        fetch(`/api/v1/social/analytics${orgId ? `?orgId=${orgId}` : ''}`),
        fetch(`/api/v1/social/analytics?view=best-times${orgId ? `&orgId=${orgId}` : ''}`),
      ])
      const [postsBody, analyticsBody, bestTimesBody] = await Promise.all([
        postsRes.json(), analyticsRes.json(), bestTimesRes.json(),
      ])
      setPosts(postsBody.data ?? [])
      setAnalytics(analyticsBody.data ?? [])
      setBestTimes(bestTimesBody.data ?? [])
    } catch {
      setPosts([])
      setAnalytics([])
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/social/reports${orgId ? `?orgId=${orgId}` : ''}`)
      const body = await res.json()
      setReports(body.data ?? [])
    } catch {
      setReports([])
    }
  }, [orgId])

  useEffect(() => { fetchReports() }, [fetchReports])

  const handleGeneratePdf = useCallback(async () => {
    setGenerating(true)
    setPdfError(null)
    try {
      const params = new URLSearchParams()
      if (orgId) params.set('orgId', orgId)
      if (range === '7d') params.set('days', '7')
      else if (range === '30d') params.set('days', '30')
      const res = await fetch(`/api/v1/social/analytics/report.pdf?${params.toString()}`)
      if (!res.ok) {
        let msg = 'Failed to generate PDF'
        try { const b = await res.json(); msg = b.error ?? msg } catch { /* non-json */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `social-analytics-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      fetchReports()
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setGenerating(false)
    }
  }, [orgId, range, fetchReports])

  const filtered = useMemo(() => {
    if (range === 'all') return posts
    const now = Date.now()
    const ms = range === '7d' ? 7 * 86400000 : 30 * 86400000
    return posts.filter((p) => {
      const d = tsToDate(p.publishedAt ?? p.scheduledFor ?? p.createdAt)
      return d ? now - d.getTime() <= ms : false
    })
  }, [posts, range])

  const stats = useMemo(() => {
    const latestByPost = new Map<string, AnalyticsSnapshot>()
    for (const snap of analytics) {
      const existing = latestByPost.get(snap.postId)
      const existingTs = existing?.collectedAt?.seconds ?? existing?.collectedAt?._seconds ?? 0
      const snapTs = snap.collectedAt?.seconds ?? snap.collectedAt?._seconds ?? 0
      if (!existing || snapTs > existingTs) {
        latestByPost.set(snap.postId, snap)
      }
    }

    let totalImpressions = 0, totalEngagements = 0, totalLikes = 0, totalComments = 0, totalShares = 0, totalClicks = 0
    for (const snap of latestByPost.values()) {
      totalImpressions += snap.metrics.impressions ?? 0
      totalEngagements += snap.metrics.engagements ?? 0
      totalLikes += snap.metrics.likes ?? 0
      totalComments += snap.metrics.comments ?? 0
      totalShares += snap.metrics.shares ?? 0
      totalClicks += snap.metrics.clicks ?? 0
    }

    const avgEngagementRate = totalImpressions > 0
      ? ((totalEngagements / totalImpressions) * 100).toFixed(2) + '%'
      : ' - '

    return { totalPublished: filtered.length, totalImpressions, totalEngagements, totalLikes, totalComments, totalShares, totalClicks, avgEngagementRate }
  }, [analytics, filtered])

  const platformBreakdown = useMemo(() => {
    const breakdown: Record<string, { impressions: number; likes: number; comments: number; shares: number; clicks: number; posts: number }> = {}
    for (const snap of analytics) {
      const p = snap.platform
      if (!breakdown[p]) breakdown[p] = { impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0, posts: 0 }
      breakdown[p].impressions += snap.metrics.impressions ?? 0
      breakdown[p].likes += snap.metrics.likes ?? 0
      breakdown[p].comments += snap.metrics.comments ?? 0
      breakdown[p].shares += snap.metrics.shares ?? 0
      breakdown[p].clicks += snap.metrics.clicks ?? 0
    }
    for (const post of filtered) {
      for (const p of getPostPlatforms(post)) {
        if (!breakdown[p]) breakdown[p] = { impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0, posts: 0 }
        breakdown[p].posts++
      }
    }
    return breakdown
  }, [analytics, filtered])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="rose">
      <PageHeader
        accent="rose"
        eyebrow="Social"
        title="Analytics"
        description="Engagement data and performance insights"
        actions={
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleGeneratePdf}
              disabled={generating}
              className="btn-pib-primary btn-pib-sm whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate PDF'}
            </button>
            {pdfError && <p className="max-w-[200px] text-right text-[10px] text-[var(--color-error)]">{pdfError}</p>}
          </div>
        }
        tabs={
          <PageTabs
            variant="segmented"
            ariaLabel="Social analytics sections"
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'posts', label: 'Per Post' },
              { value: 'best-times', label: 'Best Times' },
            ]}
          />
        }
      />

      {/* Date range filter */}
      <div className="pib-tabs pib-tabs-segmented w-fit">
        {([
          { key: '7d' as DateRange, label: 'Last 7 days' },
          { key: '30d' as DateRange, label: 'Last 30 days' },
          { key: 'all' as DateRange, label: 'All time' },
        ]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setRange(opt.key)}
            className={`pib-tab ${range === opt.key ? 'pib-tab-active' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Overview tab ── */}
          {tab === 'overview' && (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Published" value={stats.totalPublished} />
                <StatCard label="Impressions" value={fmtNum(stats.totalImpressions)} />
                <StatCard label="Engagements" value={fmtNum(stats.totalEngagements)} />
                <StatCard label="Engagement Rate" value={stats.avgEngagementRate} />
              </div>

              {/* Engagement Breakdown  -  Horizontal Bar Chart */}
              <div className="pib-card space-y-3">
                <p className="pib-label">
                  Engagement Breakdown
                </p>
                <HorizontalBarChart
                  data={[
                    { label: 'Likes', value: stats.totalLikes, color: 'var(--st-success)' },
                    { label: 'Comments', value: stats.totalComments, color: 'var(--sc-ink-soft)' },
                    { label: 'Shares', value: stats.totalShares, color: 'var(--st-danger)' },
                    { label: 'Clicks', value: stats.totalClicks, color: 'var(--sc-accent)' },
                  ]}
                  valueFormatter={fmtNum}
                />
              </div>

              {/* Platform Breakdown  -  Donut + Detail Cards */}
              {Object.keys(platformBreakdown).length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Donut */}
                  <div className="pib-card space-y-3">
                    <p className="pib-label">
                      By Platform
                    </p>
                    <DonutChart
                      data={Object.entries(platformBreakdown).map(([platform, data]) => ({
                        name: platform.charAt(0).toUpperCase() + platform.slice(1),
                        value: data.posts,
                      }))}
                      centerValue={stats.totalPublished}
                      centerLabel="Posts"
                    />
                  </div>

                  {/* Platform Detail Cards */}
                  <div className="pib-card space-y-3">
                    <p className="pib-label">
                      Platform Performance
                    </p>
                    <div className="space-y-2">
                      {Object.entries(platformBreakdown).map(([platform, data]) => (
                        <div key={platform} className="flex items-center gap-3 rounded-lg border border-[var(--color-pib-line)] p-3">
                          <PlatformBadge platform={platform} />
                          <span className="text-xs text-[var(--color-pib-text-muted)] flex-1">{data.posts} posts</span>
                          <div className="flex gap-4 text-right">
                            {[
                              { label: 'Impr.', val: data.impressions },
                              { label: 'Likes', val: data.likes },
                              { label: 'Shares', val: data.shares },
                            ].map(m => (
                              <div key={m.label}>
                                <p className="text-[10px] text-[var(--color-pib-text-muted)]">{m.label}</p>
                                <p className="text-xs font-medium text-[var(--color-pib-text)]">{fmtNum(m.val)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {analytics.length === 0 && (
                <div className="pib-card text-xs text-[var(--color-pib-text-muted)]">
                  No analytics data collected yet. Analytics are gathered automatically at 1h, 24h, 7d, and 30d after publishing.{' '}
                  <span className="font-medium text-[var(--color-pib-text)]">Published posts will start showing data after the first collection cycle.</span>
                </div>
              )}
            </div>
          )}

          {/* ── Per-post tab ── */}
          {tab === 'posts' && (
            <div className="space-y-4">
              {filtered.length === 0 ? (
                <div className="pib-empty-state">
                  <Icon name="query_stats" />
                  <h2 className="pib-empty-state-title">No published posts found.</h2>
                </div>
              ) : (
                <div className="pib-surface pib-surface-table overflow-hidden">
                  <div className="grid grid-cols-[90px_1fr_80px_80px_80px_80px_80px] gap-3 px-4 py-2.5 border-b border-[var(--color-pib-line)]">
                    {['Platform', 'Content', 'Impr.', 'Likes', 'Comments', 'Shares', 'Clicks'].map((h) => (
                      <span key={h} className="pib-label">{h}</span>
                    ))}
                  </div>

                  {filtered.map((post, i) => {
                    const platforms = getPostPlatforms(post)
                    const text = getPostText(post)
                    const postSnaps = analytics.filter(s => s.postId === post.id)
                    const totals = { impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0 }
                    const seen = new Set<string>()
                    for (const snap of postSnaps.sort((a, b) => (b.collectedAt?.seconds ?? 0) - (a.collectedAt?.seconds ?? 0))) {
                      if (seen.has(snap.platform)) continue
                      seen.add(snap.platform)
                      totals.impressions += snap.metrics.impressions ?? 0
                      totals.likes += snap.metrics.likes ?? 0
                      totals.comments += snap.metrics.comments ?? 0
                      totals.shares += snap.metrics.shares ?? 0
                      totals.clicks += snap.metrics.clicks ?? 0
                    }
                    const hasData = postSnaps.length > 0

                    return (
                      <div
                        key={post.id ?? i}
                        className={`grid grid-cols-[90px_1fr_80px_80px_80px_80px_80px] gap-3 px-4 py-3 items-start hover:bg-[var(--color-row-hover)] ${i > 0 ? 'border-t border-[var(--color-pib-line)]' : ''}`}
                      >
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {platforms.map((p) => <PlatformBadge key={p} platform={p} />)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-[var(--color-pib-text)] truncate">{text.slice(0, 80)}{text.length > 80 ? '…' : ''}</p>
                          <p className="text-[10px] text-[var(--color-pib-text-muted)] mt-0.5">{fmtDate(post.publishedAt ?? post.scheduledFor)}</p>
                        </div>
                        <span className={`text-xs pt-0.5 ${hasData ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]/40'}`}>{fmtNum(totals.impressions)}</span>
                        <span className={`text-xs pt-0.5 ${hasData ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]/40'}`}>{fmtNum(totals.likes)}</span>
                        <span className={`text-xs pt-0.5 ${hasData ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]/40'}`}>{fmtNum(totals.comments)}</span>
                        <span className={`text-xs pt-0.5 ${hasData ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]/40'}`}>{fmtNum(totals.shares)}</span>
                        <span className={`text-xs pt-0.5 ${hasData ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]/40'}`}>{fmtNum(totals.clicks)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Best times tab ── */}
          {tab === 'best-times' && (
            <div className="space-y-4">
              {bestTimes.length === 0 ? (
                <div className="pib-empty-state">
                  <Icon name="schedule" />
                  <h2 className="pib-empty-state-title">Not enough data to calculate best posting times</h2>
                  <p className="pib-empty-state-description">Keep publishing and analytics will be collected automatically.</p>
                </div>
              ) : (
                <>
                  <div className="pib-card space-y-3">
                    <h3 className="pib-label">Top Posting Times</h3>
                    <div className="space-y-2">
                      {bestTimes.slice(0, 5).map((slot, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-[var(--color-pib-text)] w-5">{i + 1}.</span>
                          <span className="text-sm text-[var(--color-pib-text)] w-24">{DAY_NAMES[slot.dayOfWeek]} {slot.hour.toString().padStart(2, '0')}:00</span>
                          <div className="flex-1 h-5 rounded border border-[var(--color-pib-line)] overflow-hidden">
                            <div className="h-full rounded bg-[var(--st-danger)]/60 transition-all" style={{ width: `${(slot.avgScore / (bestTimes[0]?.avgScore || 1)) * 100}%` }} />
                          </div>
                          <span className="text-xs text-[var(--color-pib-text-muted)] w-20 text-right">Score: {slot.avgScore} ({slot.postCount})</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pib-card space-y-3">
                    <h3 className="pib-label">Engagement Heatmap</h3>
                    <div className="overflow-x-auto">
                      <div className="min-w-[600px]">
                        <div className="flex gap-1 ml-12 mb-1">
                          {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="w-8 text-center text-[9px] text-[var(--color-pib-text-muted)]">{h.toString().padStart(2, '0')}</div>
                          ))}
                        </div>
                        {DAY_NAMES.map((day, dayIdx) => {
                          const maxScore = Math.max(...bestTimes.map(s => s.avgScore), 1)
                          return (
                            <div key={day} className="flex items-center gap-1 mb-1">
                              <span className="text-xs text-[var(--color-pib-text-muted)] w-10 text-right">{day}</span>
                              {Array.from({ length: 24 }, (_, h) => {
                                const slot = bestTimes.find(s => s.dayOfWeek === dayIdx && s.hour === h)
                                return <HeatCell key={h} value={slot?.avgScore ?? 0} max={maxScore} />
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Reports history ── */}
      {reports.length > 0 && (
        <div className="pib-card space-y-3">
          <p className="pib-label">
            Reports History
          </p>
          <div className="space-y-2">
            {reports.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-pib-line)] p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0">
                    <Icon name="description" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--color-pib-text)] truncate">{r.title}</p>
                    <p className="text-[10px] text-[var(--color-pib-text-muted)] mt-0.5">
                      {r.dateRange?.label ?? 'All time'} · Generated {fmtDate(r.createdAt)}
                    </p>
                  </div>
                </div>
                <span className="pib-pill uppercase shrink-0">
                  PDF
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
