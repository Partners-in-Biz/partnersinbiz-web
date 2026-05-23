'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ProfileCompleteBanner } from '@/components/settings/ProfileCompleteBanner'
import { TopCompaniesByPipelineTile } from '@/components/dashboard/TopCompaniesByPipelineTile'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import { DonutChart, HorizontalBarChart, StatCardWithChart, TrendAreaChart } from '@/components/ui/Charts'

interface Kpis {
  total_revenue: number
  mrr: number
  arr: number
  active_subs: number
  ad_revenue: number
  iap_revenue: number
  installs: number
  sessions: number
  outstanding: number
  invoiced_revenue_paid: number
  deltas: Record<string, number | null>
}

interface PortalProperty {
  id: string
  name: string
  type: string
  domain?: string
}

interface Project {
  id: string
  name: string
  status: string
  description?: string
}

interface SocialStats {
  total: number
  byStatus: {
    draft: number
    pending_approval: number
    approved: number
    scheduled: number
    published: number
    failed: number
    cancelled: number
  }
  byPlatform: Record<string, number>
  approvalRate: number
  last30Days: number
  last30DaysSeries?: { label: string; value: number }[]
}

interface PortalConnection {
  id: string
  provider: string
  propertyId: string
  status: string
}

interface PortalReport {
  id: string
  type: string
  period: { start: string; end: string }
  status: string
  publicToken: string | null
  kpis: { total_revenue: number; mrr: number }
  sentAt: { _seconds: number } | null
  createdAt: { _seconds: number } | null
}

interface DashboardData {
  kpis: Kpis
  period: { start: string; end: string }
  properties: PortalProperty[]
  connections: PortalConnection[]
  reports: PortalReport[]
}

interface CrmDashboardData {
  openDealsCount: number
  openDealsValue: number
  weightedPipelineValue: number
  wonThisMonth: { count: number; value: number }
  lostThisMonth: { count: number }
  recentActivities: Array<{
    id: string; type?: string; summary?: string; createdAt?: unknown;
    createdByRef?: { displayName?: string }; contactId?: string
  }>
  topOpenDeals: Array<{
    id: string; title?: string; value?: number; currency?: string;
    probability?: number; stageId?: string
  }>
}

const EMPTY_CRM_DASHBOARD: CrmDashboardData = {
  openDealsCount: 0,
  openDealsValue: 0,
  weightedPipelineValue: 0,
  wonThisMonth: { count: 0, value: 0 },
  lostThisMonth: { count: 0 },
  recentActivities: [],
  topOpenDeals: [],
}

function normalizeCrmDashboardPayload(body: unknown): CrmDashboardData | null {
  const payload = body as { success?: boolean; data?: Partial<CrmDashboardData> } | Partial<CrmDashboardData> | null
  if (!payload) return null
  if ('success' in payload && payload.success === false) return null
  const data = (('data' in payload ? payload.data : payload) ?? {}) as Partial<CrmDashboardData>
  if (typeof data !== 'object') return null

  return {
    openDealsCount: typeof data.openDealsCount === 'number' ? data.openDealsCount : 0,
    openDealsValue: typeof data.openDealsValue === 'number' ? data.openDealsValue : 0,
    weightedPipelineValue: typeof data.weightedPipelineValue === 'number' ? data.weightedPipelineValue : 0,
    wonThisMonth: {
      count: typeof data.wonThisMonth?.count === 'number' ? data.wonThisMonth.count : 0,
      value: typeof data.wonThisMonth?.value === 'number' ? data.wonThisMonth.value : 0,
    },
    lostThisMonth: {
      count: typeof data.lostThisMonth?.count === 'number' ? data.lostThisMonth.count : 0,
    },
    recentActivities: Array.isArray(data.recentActivities) ? data.recentActivities : [],
    topOpenDeals: Array.isArray(data.topOpenDeals) ? data.topOpenDeals : [],
  }
}

const fmtZar = new Intl.NumberFormat('en-ZA', {
  style: 'currency', currency: 'ZAR', maximumFractionDigits: 0,
})
const fmtNum = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

const PLATFORM_COLORS: Record<string, string> = {
  twitter: '#000000',
  x: '#000000',
  linkedin: '#0A66C2',
  facebook: '#1877F2',
  instagram: '#E4405F',
  tiktok: '#69C9D0',
  reddit: '#FF4500',
  pinterest: '#E60023',
  bluesky: '#0085FF',
  threads: '#555',
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: 'Active', color: 'var(--color-pib-accent)' },
    on_hold: { label: 'On Hold', color: '#facc15' },
    completed: { label: 'Completed', color: '#4ade80' },
    archived: { label: 'Archived', color: 'var(--color-pib-text-muted)' },
    in_progress: { label: 'In Progress', color: 'var(--color-pib-accent)' },
    discovery: { label: 'Discovery', color: '#60a5fa' },
    design: { label: 'Design', color: '#a78bfa' },
    development: { label: 'Development', color: '#38bdf8' },
    review: { label: 'Review', color: '#f59e0b' },
    live: { label: 'Live', color: '#4ade80' },
    maintenance: { label: 'Maintenance', color: '#22d3ee' },
  }
  const s = map[status] ?? { label: status, color: 'var(--color-pib-text-muted)' }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-label uppercase tracking-wide"
      style={{ background: `${s.color}20`, color: s.color }}
    >
      {s.label}
    </span>
  )
}

function fmtPct(p: number | null) {
  if (p === null) return '—'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}
function deltaClass(p: number | null) {
  if (p === null) return 'text-[var(--color-pib-text-muted)]'
  if (p > 0) return 'text-[var(--color-pib-success)]'
  if (p < 0) return 'text-[#FCA5A5]'
  return 'text-[var(--color-pib-text-muted)]'
}

function formatCurrency(value: number, currency = 'ZAR') {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(0)}`
  }
}

function activityIcon(type?: string): string {
  if (!type) return 'info'
  if (type.startsWith('email')) return 'mail'
  if (type === 'call') return 'call'
  if (type === 'note') return 'sticky_note_2'
  if (type === 'stage_change') return 'swap_horiz'
  if (type.startsWith('sequence')) return 'send'
  return 'info'
}

function Tile({
  label,
  value,
  delta,
  hint,
  icon,
  emphasis,
}: {
  label: string
  value: string
  delta?: number | null
  hint?: string
  icon?: string
  emphasis?: boolean
}) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        {icon && <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>}
      </div>
      <p
        className={[
          'mt-3 font-display tracking-tight leading-none',
          emphasis ? 'text-4xl md:text-5xl text-[var(--color-pib-accent)]' : 'text-3xl md:text-4xl text-[var(--color-pib-text)]',
        ].join(' ')}
      >
        {value}
      </p>
      {(delta !== undefined || hint) && (
        <p className="mt-3 text-xs">
          {delta !== undefined && (
            <span className={`font-mono ${deltaClass(delta ?? null)}`}>
              {fmtPct(delta ?? null)}
              <span className="text-[var(--color-pib-text-muted)] ml-1">vs prior</span>
            </span>
          )}
          {hint && <span className="text-[var(--color-pib-text-muted)] ml-2">{hint}</span>}
        </p>
      )}
    </div>
  )
}

interface CampaignStats {
  contacts: number | null
  activeCampaigns: number | null
  captureSources: number | null
}

export default function PortalDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [socialStats, setSocialStats] = useState<SocialStats | null>(null)
  const [socialLoading, setSocialLoading] = useState(true)
  const [stats, setStats] = useState<CampaignStats>({
    contacts: null,
    activeCampaigns: null,
    captureSources: null,
  })
  const [crmData, setCrmData] = useState<CrmDashboardData | null>(null)
  const [crmLoading, setCrmLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/portal/dashboard')
      .then((r) => r.json())
      .then((b) => { setData(b); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/v1/projects')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setProjects(Array.isArray(body?.data) ? body.data : []))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/v1/social/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setSocialStats(body?.data ?? null))
      .catch(() => setSocialStats(null))
      .finally(() => setSocialLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/v1/crm/dashboard')
      .then(async r => {
        const body = await r.json().catch(() => null)
        return r.ok ? normalizeCrmDashboardPayload(body) : null
      })
      .then(data => setCrmData(data ?? EMPTY_CRM_DASHBOARD))
      .catch(() => setCrmData(EMPTY_CRM_DASHBOARD))
      .finally(() => setCrmLoading(false))
  }, [])

  useEffect(() => {
    // Total contacts — read meta.total
    fetch('/api/v1/crm/contacts?limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b) {
          const total = b.meta?.total ?? (Array.isArray(b.data) ? b.data.length : 0)
          setStats((s) => ({ ...s, contacts: total }))
        }
      })
      .catch(() => {})

    // Active campaigns
    fetch('/api/v1/campaigns?status=active')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b) {
          const count = Array.isArray(b.data) ? b.data.length : (b.meta?.total ?? 0)
          setStats((s) => ({ ...s, activeCampaigns: count }))
        }
      })
      .catch(() => {})

    // Capture sources
    fetch('/api/v1/crm/capture-sources')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b) {
          const count = Array.isArray(b.data) ? b.data.length : (b.meta?.total ?? 0)
          setStats((s) => ({ ...s, captureSources: count }))
        }
      })
      .catch(() => {})
  }, [])

  const noData = !loading && (!data || (data?.connections?.length ?? 0) === 0)
  const activeProjects = projects.filter(p => ['active', 'in_progress', 'development', 'review', 'live', 'maintenance'].includes(p.status))
  const workspaceLoading = loading || projectsLoading || socialLoading
  const statusDonut = socialStats ? [
    { name: 'Published', value: socialStats.byStatus.published, color: '#4ade80' },
    { name: 'Scheduled', value: socialStats.byStatus.scheduled, color: '#60a5fa' },
    { name: 'Pending', value: socialStats.byStatus.pending_approval, color: '#F59E0B' },
    { name: 'Draft', value: socialStats.byStatus.draft, color: '#666' },
  ].filter(d => d.value > 0) : []
  const platformBarData = socialStats
    ? Object.entries(socialStats.byPlatform).map(([platform, count]) => ({
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        value: count,
        color: PLATFORM_COLORS[platform.toLowerCase()] ?? '#F59E0B',
      }))
    : []
  const last30DaysData = socialStats?.last30DaysSeries?.length
    ? socialStats.last30DaysSeries
    : Array.from({ length: 7 }, (_, i) => ({ label: `W${i + 1}`, value: 0 }))
  const hasLast30DaysData = last30DaysData.some(point => point.value > 0)

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <ProfileCompleteBanner />

      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow !text-[10px]">Workspace</p>
            <h1 className="mt-1 text-2xl font-headline font-bold text-on-surface">
              {getGreeting()}.
            </h1>
            <p className="mt-0.5 text-sm text-on-surface-variant">
              {new Date().toLocaleDateString('en-ZA', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/portal/projects" className="btn-pib-accent text-sm">
              + New Project
            </Link>
            <Link href="/portal/properties" className="btn-pib-secondary text-sm">
              Set Properties
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {workspaceLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : (
            <>
              <StatCardWithChart
                label="Projects"
                value={projects.length}
                sub={`${activeProjects.length} active`}
                trend={activeProjects.length > 0 ? 'up' : undefined}
                accent
              />
              <StatCardWithChart
                label="Posts Published"
                value={socialStats?.byStatus.published ?? 0}
                sub={`${socialStats?.last30Days ?? 0} last 30d`}
                trend={hasLast30DaysData ? 'up' : undefined}
                data={hasLast30DaysData ? last30DaysData.map(d => ({ value: d.value })) : undefined}
                chartType="area"
              />
              <StatCardWithChart
                label="Pending Approval"
                value={socialStats?.byStatus.pending_approval ?? 0}
                accent={(socialStats?.byStatus.pending_approval ?? 0) > 0}
              />
              <StatCardWithChart
                label="Approval Rate"
                value={socialStats?.approvalRate ? `${Math.round(socialStats.approvalRate)}%` : '—'}
                sub="all time"
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="pib-card space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Projects</p>
              <Link href="/portal/projects" className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-accent)]">
                View all →
              </Link>
            </div>

            {projectsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : projects.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-on-surface-variant">No projects yet.</p>
                <Link href="/portal/projects" className="mt-2 inline-block text-sm text-[var(--color-pib-accent)]">
                  Start the first one →
                </Link>
              </div>
            ) : (
              <div className="-mx-6 space-y-1">
                {projects.slice(0, 6).map((project) => (
                  <Link
                    key={project.id}
                    href={`/portal/projects/${project.id}`}
                    className="flex items-center gap-4 rounded-lg px-6 py-3 transition-colors hover:bg-[var(--color-row-hover)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-on-surface">{project.name}</p>
                      {project.description && (
                        <p className="mt-0.5 truncate text-xs text-on-surface-variant">{project.description}</p>
                      )}
                    </div>
                    <StatusBadge status={project.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="pib-card space-y-2">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Post Status
            </p>
            {socialLoading ? (
              <Skeleton className="h-[220px]" />
            ) : statusDonut.length > 0 ? (
              <DonutChart data={statusDonut} centerValue={socialStats?.total ?? 0} centerLabel="Total" />
            ) : (
              <div className="py-8 text-center text-sm text-on-surface-variant">
                No social posts yet.
              </div>
            )}
          </div>
        </div>

        {!socialLoading && socialStats && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {platformBarData.length > 0 && (
              <div className="pib-card space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Platform Breakdown
                  </p>
                  <Link href="/portal/social" className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-accent)]">
                    View Social →
                  </Link>
                </div>
                <HorizontalBarChart data={platformBarData} />
              </div>
            )}

            <div className="pib-card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Publishing Trend
                  </p>
                  <p className="mt-0.5 text-lg font-headline font-bold text-on-surface">
                    {socialStats.last30Days} posts
                  </p>
                </div>
                <span className="rounded bg-[var(--color-surface-container)] px-2 py-1 text-[10px] text-on-surface-variant">
                  Last 30 days
                </span>
              </div>
              {hasLast30DaysData ? (
                <TrendAreaChart data={last30DaysData} height={160} color="#4ade80" />
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-on-surface-variant">
                  No posts in the last 30 days.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pib-card">
          <p className="mb-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Quick Actions</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Projects', href: '/portal/projects' },
              { label: 'Messages', href: '/portal/messages' },
              { label: 'Properties', href: '/portal/properties' },
              { label: 'Reports', href: '/portal/reports' },
              { label: 'Marketing', href: '/portal/marketing' },
              { label: 'Team', href: '/portal/settings/team' },
            ].map(a => (
              <Link key={a.href} href={a.href} className="pib-btn-secondary text-xs font-label">{a.label}</Link>
            ))}
          </div>
        </div>
      </section>

      {/* Campaigns section */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="eyebrow">Campaigns</h2>
          <Link
            href="/portal/campaigns"
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
          >
            All campaigns
            <span className="material-symbols-outlined text-sm">arrow_outward</span>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/portal/contacts" className="pib-stat-card hover:border-[var(--color-pib-accent)] transition-colors group">
            <div className="flex items-start justify-between">
              <p className="eyebrow !text-[10px]">Contacts</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] group-hover:text-[var(--color-pib-accent)] transition-colors">contacts</span>
            </div>
            <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl text-[var(--color-pib-text)]">
              {stats.contacts === null ? '—' : fmtNum.format(stats.contacts)}
            </p>
            <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">total in your audience</p>
          </Link>

          <Link href="/portal/campaigns" className="pib-stat-card hover:border-[var(--color-pib-accent)] transition-colors group">
            <div className="flex items-start justify-between">
              <p className="eyebrow !text-[10px]">Active campaigns</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] group-hover:text-[var(--color-pib-accent)] transition-colors">campaign</span>
            </div>
            <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl text-[var(--color-pib-text)]">
              {stats.activeCampaigns === null ? '—' : fmtNum.format(stats.activeCampaigns)}
            </p>
            <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">running right now</p>
          </Link>

          <Link href="/portal/capture-sources" className="pib-stat-card hover:border-[var(--color-pib-accent)] transition-colors group">
            <div className="flex items-start justify-between">
              <p className="eyebrow !text-[10px]">Capture sources</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] group-hover:text-[var(--color-pib-accent)] transition-colors">inventory_2</span>
            </div>
            <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl text-[var(--color-pib-text)]">
              {stats.captureSources === null ? '—' : fmtNum.format(stats.captureSources)}
            </p>
            <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">funneling leads in</p>
          </Link>
        </div>
      </section>

      {/* CRM — Top companies tile (self-hides when no companies exist) */}
      <TopCompaniesByPipelineTile />

      {/* Pipeline / CRM section */}
      {!crmLoading && crmData && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="eyebrow">Pipeline</h2>
            <Link
              href="/portal/deals"
              className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
            >
              View deals
              <span className="material-symbols-outlined text-sm">arrow_outward</span>
            </Link>
          </div>

          {/* 4 metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bento-card !p-4">
              <p className="eyebrow !text-[10px] mb-1">Open Deals</p>
              <p className="text-2xl font-bold">{crmData.openDealsCount}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{formatCurrency(crmData.openDealsValue)}</p>
            </div>
            <div className="bento-card !p-4">
              <p className="eyebrow !text-[10px] mb-1">Weighted Pipeline</p>
              <p className="text-2xl font-bold">{formatCurrency(crmData.weightedPipelineValue)}</p>
            </div>
            <div className="bento-card !p-4">
              <p className="eyebrow !text-[10px] mb-1">Won This Month</p>
              <p className="text-2xl font-bold text-emerald-400">{crmData.wonThisMonth.count}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{formatCurrency(crmData.wonThisMonth.value)}</p>
            </div>
            <div className="bento-card !p-4">
              <p className="eyebrow !text-[10px] mb-1">Lost This Month</p>
              <p className="text-2xl font-bold text-red-400">{crmData.lostThisMonth.count}</p>
            </div>
          </div>

          {/* Activity feed + top deals row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent activity feed */}
            <div className="bento-card !p-5">
              <p className="eyebrow !text-[10px] mb-4">Recent Activity</p>
              {crmData.recentActivities.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No recent activity.</p>
              ) : (
                crmData.recentActivities.map(a => (
                  <div key={a.id} className="flex items-start gap-2 py-2 border-b border-[var(--color-pib-line)] last:border-0">
                    <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)] mt-0.5">
                      {activityIcon(a.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{a.summary ?? a.type}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        {a.createdByRef?.displayName ?? ''}
                        {a.createdByRef?.displayName && a.createdAt ? ' · ' : ''}
                        {fmtTimestamp(a.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Top open deals mini-table */}
            <div className="bento-card !p-5">
              <p className="eyebrow !text-[10px] mb-4">Top Open Deals</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--color-pib-text-muted)] border-b border-[var(--color-pib-line)]">
                    <th className="text-left pb-2">Deal</th>
                    <th className="text-right pb-2">Value</th>
                    <th className="text-right pb-2">Prob</th>
                  </tr>
                </thead>
                <tbody>
                  {crmData.topOpenDeals.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[var(--color-pib-text-muted)]">No open deals</td>
                    </tr>
                  ) : (
                    crmData.topOpenDeals.map(d => (
                      <tr key={d.id} className="border-b border-[var(--color-pib-line)] last:border-0">
                        <td className="py-2">{d.title ?? '—'}</td>
                        <td className="py-2 text-right">{formatCurrency(d.value ?? 0, d.currency)}</td>
                        <td className="py-2 text-right text-[var(--color-pib-text-muted)]">{d.probability ?? '—'}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="pib-skeleton h-32" />
          ))}
        </div>
      )}

      {noData && (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">link</span>
          <h2 className="font-display text-2xl mt-4">No data yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-md mx-auto mt-2 text-pretty">
            Once your team connects integrations (RevenueCat, AdSense, AdMob, App Store Connect, Play Console, Google Ads, GA4),
            KPIs will appear here within 24 hours.
          </p>
          <Link href="/portal/properties" className="btn-pib-secondary mt-6">
            Manage properties
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </Link>
        </div>
      )}

      {!loading && data && data.connections.length > 0 && (
        <>
          {/* Headline KPIs */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="eyebrow">Headline metrics</h2>
              <span className="text-xs text-[var(--color-pib-text-muted)] font-mono">Month-to-date</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Tile label="Total revenue" value={fmtZar.format(data.kpis.total_revenue)} delta={data.kpis.deltas.total_revenue} icon="payments" emphasis />
              <Tile label="MRR" value={fmtZar.format(data.kpis.mrr)} delta={data.kpis.deltas.mrr} icon="trending_up" />
              <Tile label="Active subs" value={fmtNum.format(data.kpis.active_subs)} delta={data.kpis.deltas.active_subs} icon="groups" />
              <Tile label="Sessions" value={fmtNum.format(data.kpis.sessions)} delta={data.kpis.deltas.sessions} icon="visibility" />
              <Tile label="Ad revenue" value={fmtZar.format(data.kpis.ad_revenue)} delta={data.kpis.deltas.ad_revenue} icon="ads_click" />
              <Tile label="IAP revenue" value={fmtZar.format(data.kpis.iap_revenue)} delta={data.kpis.deltas.iap_revenue} icon="shopping_bag" />
              <Tile label="Installs" value={fmtNum.format(data.kpis.installs)} delta={data.kpis.deltas.installs} icon="download" />
              <Tile label="Outstanding" value={fmtZar.format(data.kpis.outstanding)} hint="invoiced, unpaid" icon="receipt_long" />
            </div>
          </section>

          {/* Latest report */}
          {data.reports.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="eyebrow">Latest report</h2>
                <Link href="/portal/reports" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors">
                  All reports
                  <span className="material-symbols-outlined text-sm">arrow_outward</span>
                </Link>
              </div>
              <div className="bento-card flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <p className="font-display text-2xl">
                    {data.reports[0].period.start} → {data.reports[0].period.end}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill">{data.reports[0].type}</span>
                    <span className={`pill ${data.reports[0].status === 'sent' ? 'pill-accent' : ''}`}>
                      {data.reports[0].status}
                    </span>
                    <span className="text-xs text-[var(--color-pib-text-muted)] font-mono">
                      Total revenue {fmtZar.format(data.reports[0].kpis.total_revenue)} · MRR {fmtZar.format(data.reports[0].kpis.mrr)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {data.reports[0].publicToken && (
                    <Link
                      href={`/reports/${data.reports[0].publicToken}`}
                      target="_blank"
                      className="btn-pib-accent !py-2 !px-4 !text-sm"
                    >
                      Open report
                      <span className="material-symbols-outlined text-base">arrow_outward</span>
                    </Link>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Properties summary */}
          {data.properties.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="eyebrow">Your properties</h2>
                <Link href="/portal/properties" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors">
                  Manage
                  <span className="material-symbols-outlined text-sm">arrow_outward</span>
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {data.properties.slice(0, 3).map((p) => {
                  const conns = data.connections.filter((c) => c.propertyId === p.id)
                  return (
                    <div key={p.id} className="bento-card !p-5">
                      <p className="eyebrow !text-[10px]">{p.type}</p>
                      <p className="font-display text-xl mt-2 leading-tight">{p.name}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)] mt-3 font-mono">
                        {conns.length} connection{conns.length === 1 ? '' : 's'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
