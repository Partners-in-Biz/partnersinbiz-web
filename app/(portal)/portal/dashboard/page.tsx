'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ProfileCompleteBanner } from '@/components/settings/ProfileCompleteBanner'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { TopCompaniesByPipelineTile } from '@/components/dashboard/TopCompaniesByPipelineTile'
import { fmtTimestamp } from '@/lib/format/timestamp'
import { ScheduledContentPreviewCards, type ScheduledContentPost } from '@/components/social/ScheduledContentPreviewCards'
import { DonutChart, HorizontalBarChart, StatCardWithChart, TrendAreaChart } from '@/components/ui/Charts'
import { EmptyState, PageHeader, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import { ButtonLink, Icon, Skeleton, Status, Table, THead, TR, TH, TD } from '@/components/studio'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

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

interface PortalOrg {
  id: string
  name: string
  slug: string
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

interface PortalDashboardSummary {
  counts?: {
    contacts?: number
    projects?: number
    activeProjects?: number
    posts?: number
    publishedPosts?: number
    pendingApprovalPosts?: number
    activeCampaigns?: number
    captureSources?: number
  }
  projects?: {
    total?: number
    active?: number
    recent?: Project[]
  }
  social?: SocialStats
  scheduledPosts?: ScheduledContentPost[]
  campaigns?: {
    active?: number
  }
  crm?: {
    contacts?: number
  }
  onboarding?: {
    social: boolean
    domain: boolean
    contact: boolean
    analytics: boolean
    post: boolean
  }
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
  summary?: PortalDashboardSummary | null
}

interface CrmDashboardData {
  openDealsCount: number
  openDealsValue: number
  weightedPipelineValue: number
  wonThisMonth: { count: number; value: number }
  lostThisMonth: { count: number }
  recentActivities: Array<{
    id: string; type?: string; summary?: string; createdAt?: unknown;
    createdByRef?: { displayName?: string }; contactId?: string; dealId?: string
  }>
  topOpenDeals: Array<{
    id: string; title?: string; value?: number; currency?: string;
    probability?: number; stageId?: string
  }>
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function crmActivityHref(activity: CrmDashboardData['recentActivities'][number]): string {
  const dealId = textValue(activity.dealId)
  if (dealId) return `/portal/deals/${encodeURIComponent(dealId)}`
  const contactId = textValue(activity.contactId)
  return contactId ? `/portal/contacts/${encodeURIComponent(contactId)}` : ''
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

const EMPTY_KPIS: Kpis = {
  total_revenue: 0,
  mrr: 0,
  arr: 0,
  active_subs: 0,
  ad_revenue: 0,
  iap_revenue: 0,
  installs: 0,
  sessions: 0,
  outstanding: 0,
  invoiced_revenue_paid: 0,
  deltas: {},
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeKpis(input: unknown): Kpis {
  const data = input && typeof input === 'object' ? input as Partial<Kpis> : {}

  return {
    total_revenue: numberValue(data.total_revenue),
    mrr: numberValue(data.mrr),
    arr: numberValue(data.arr),
    active_subs: numberValue(data.active_subs),
    ad_revenue: numberValue(data.ad_revenue),
    iap_revenue: numberValue(data.iap_revenue),
    installs: numberValue(data.installs),
    sessions: numberValue(data.sessions),
    outstanding: numberValue(data.outstanding),
    invoiced_revenue_paid: numberValue(data.invoiced_revenue_paid),
    deltas: data.deltas && typeof data.deltas === 'object' ? data.deltas : {},
  }
}

function normalizeDashboardPayload(body: unknown): DashboardData | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as { data?: unknown; ok?: boolean }
  if (payload.ok === false) return null
  const source = ((payload.data && typeof payload.data === 'object') ? payload.data : payload) as Partial<DashboardData>

  return {
    kpis: normalizeKpis(source.kpis ?? EMPTY_KPIS),
    period: source.period ?? { start: '', end: '' },
    properties: Array.isArray(source.properties) ? source.properties : [],
    connections: Array.isArray(source.connections) ? source.connections : [],
    reports: Array.isArray(source.reports) ? source.reports : [],
    summary: source.summary && typeof source.summary === 'object' ? source.summary as PortalDashboardSummary : null,
  }
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

function projectStatusTone(status: string): 'success' | 'warning' | 'info' | 'danger' | undefined {
  switch (status) {
    case 'active':
    case 'live':
    case 'completed':
      return 'success'
    case 'on_hold':
    case 'review':
      return 'warning'
    case 'in_progress':
    case 'discovery':
    case 'design':
    case 'development':
    case 'maintenance':
      return 'info'
    case 'archived':
      return undefined
    default:
      return undefined
  }
}

function projectStatusLabel(status: string): string {
  const map: Record<string, string> = {
    active: 'Active',
    on_hold: 'On hold',
    completed: 'Completed',
    archived: 'Archived',
    in_progress: 'In progress',
    discovery: 'Discovery',
    design: 'Design',
    development: 'Development',
    review: 'Review',
    live: 'Live',
    maintenance: 'Maintenance',
  }
  return map[status] ?? status
}

function fmtPct(p: number | null) {
  if (p === null) return '-'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function deltaClass(p: number | null) {
  if (p === null) return 'text-[var(--sc-ink-soft)]'
  if (p > 0) return 'text-[var(--st-success)]'
  if (p < 0) return 'text-[var(--st-danger)]'
  return 'text-[var(--sc-ink-soft)]'
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
}: {
  label: string
  value: string
  delta?: number | null
  hint?: string
  icon?: string
  emphasis?: boolean
}) {
  return (
    <StatCard
      label={label}
      value={value}
      icon={icon}
      detail={(
        <>
          {delta !== undefined ? (
            <span className={`font-mono ${deltaClass(delta ?? null)}`}>
              {fmtPct(delta ?? null)}
              <span className="ml-1 text-[var(--sc-ink-soft)]">vs prior</span>
            </span>
          ) : null}
          {hint ? <span className="ml-2 text-[var(--sc-ink-soft)]">{hint}</span> : null}
        </>
      )}
    />
  )
}

interface CampaignStats {
  contacts: number | null
  activeCampaigns: number | null
  captureSources: number | null
}

export default function PortalDashboard() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [portalOrg, setPortalOrg] = useState<PortalOrg | null>(null)
  const [portalOrgLoaded, setPortalOrgLoaded] = useState(false)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [portalUserRole, setPortalUserRole] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [socialStats, setSocialStats] = useState<SocialStats | null>(null)
  const [socialLoading, setSocialLoading] = useState(true)
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledContentPost[]>([])
  const [scheduledLoading, setScheduledLoading] = useState(true)
  const [stats, setStats] = useState<CampaignStats>({
    contacts: null,
    activeCampaigns: null,
    captureSources: null,
  })
  const [crmData, setCrmData] = useState<CrmDashboardData | null>(null)
  const [crmLoading, setCrmLoading] = useState(true)
  const [firstName, setFirstName] = useState('')
  const scopedHref = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])
  const scopedApi = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  useEffect(() => {
    fetch('/api/v1/portal/settings/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const name = typeof d?.profile?.firstName === 'string' ? d.profile.firstName.trim() : ''
        if (name) setFirstName(name)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(scopedApi('/api/v1/portal/org'))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        setPortalOrg(body?.org ?? null)
        setMemberRole(typeof body?.user?.memberRole === 'string' ? body.user.memberRole : null)
        setPortalUserRole(typeof body?.user?.role === 'string' ? body.user.role : null)
      })
      .catch(() => setPortalOrg(null))
      .finally(() => setPortalOrgLoaded(true))
  }, [scopedApi])

  useEffect(() => {
    fetch(scopedApi('/api/v1/portal/dashboard'))
      .then(async (r) => (r.ok ? normalizeDashboardPayload(await r.json().catch(() => null)) : null))
      .then((b) => { setData(b); setLoading(false) })
      .catch(() => { setData(null); setLoading(false) })
  }, [scopedApi])

  useEffect(() => {
    if (!portalOrgLoaded) return
    if (Array.isArray(data?.summary?.projects?.recent)) {
      setProjects(data.summary.projects.recent)
      setProjectsLoading(false)
      return
    }
    if (!loading) {
      setProjects([])
      setProjectsLoading(false)
      return
    }
  }, [portalOrgLoaded, loading, data?.summary?.projects?.recent])

  useEffect(() => {
    if (data?.summary?.social) {
      setSocialStats(data.summary.social)
      setSocialLoading(false)
      return
    }
    if (!loading) {
      setSocialStats(null)
      setSocialLoading(false)
    }
  }, [loading, data?.summary?.social])

  useEffect(() => {
    if (Array.isArray(data?.summary?.scheduledPosts)) {
      setScheduledPosts(data.summary.scheduledPosts)
      setScheduledLoading(false)
      return
    }
    if (!loading) {
      setScheduledPosts([])
      setScheduledLoading(false)
    }
  }, [loading, data?.summary?.scheduledPosts])

  useEffect(() => {
    fetch(scopedApi('/api/v1/crm/dashboard'))
      .then(async r => {
        const body = await r.json().catch(() => null)
        return r.ok ? normalizeCrmDashboardPayload(body) : null
      })
      .then(data => setCrmData(data ?? EMPTY_CRM_DASHBOARD))
      .catch(() => setCrmData(EMPTY_CRM_DASHBOARD))
      .finally(() => setCrmLoading(false))
  }, [scopedApi])

  useEffect(() => {
    if (data?.summary) {
      setStats({
        contacts: data.summary.counts?.contacts ?? data.summary.crm?.contacts ?? 0,
        activeCampaigns: data.summary.counts?.activeCampaigns ?? data.summary.campaigns?.active ?? 0,
        captureSources: data.summary.counts?.captureSources ?? 0,
      })
      return
    }
    if (!loading) {
      setStats({ contacts: 0, activeCampaigns: 0, captureSources: 0 })
    }
  }, [loading, data?.summary])

  const noData = !loading && (!data || (data?.connections?.length ?? 0) === 0)
  const activeProjects = projects.filter(p => ['active', 'in_progress', 'development', 'review', 'live', 'maintenance'].includes(p.status))
  const projectTotal = data?.summary?.projects?.total ?? data?.summary?.counts?.projects ?? projects.length
  const activeProjectTotal = data?.summary?.projects?.active ?? data?.summary?.counts?.activeProjects ?? activeProjects.length
  const workspaceLoading = !portalOrgLoaded || loading || projectsLoading || socialLoading
  const orgName = portalOrg?.name?.trim() || 'your workspace'
  const orgSlug = portalOrg?.slug?.trim() || 'workspace'
  const statusDonut = socialStats ? [
    { name: 'Published', value: socialStats.byStatus.published, color: 'var(--st-success)' },
    { name: 'Scheduled', value: socialStats.byStatus.scheduled, color: 'var(--st-info)' },
    { name: 'Pending', value: socialStats.byStatus.pending_approval, color: 'var(--st-warning)' },
    { name: 'Draft', value: socialStats.byStatus.draft, color: 'var(--sc-ink-soft)' },
  ].filter(d => d.value > 0) : []
  const platformBarData = socialStats
    ? Object.entries(socialStats.byPlatform).map(([platform, count]) => ({
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        value: count,
        color: PLATFORM_COLORS[platform.toLowerCase()] ?? 'var(--sc-ink)',
      }))
    : []
  const last30DaysData = socialStats?.last30DaysSeries?.length
    ? socialStats.last30DaysSeries
    : Array.from({ length: 7 }, (_, i) => ({ label: `W${i + 1}`, value: 0 }))
  const hasLast30DaysData = last30DaysData.some(point => point.value > 0)

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <ProfileCompleteBanner />

      <Surface className="flex items-center gap-3 !px-4 !py-3">
        <Icon name="waving_hand" className="shrink-0 text-[var(--sc-ink-soft)]" />
        <div className="min-w-0">
          <p className="sc-tiny">{getGreeting()}</p>
          <p className="st-title mt-0.5 text-[var(--sc-ink)]">
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
          </p>
        </div>
      </Surface>

      {memberRole === 'owner' || memberRole === 'admin' || (memberRole == null && portalUserRole === 'admin') ? (
        <OnboardingChecklist
          scopedHref={scopedHref}
          scopedApi={scopedApi}
          initialDone={data?.summary?.onboarding ?? undefined}
        />
      ) : null}

      <section className="space-y-4">
        <PageHeader
          eyebrow="Workspace"
          title={`${getGreeting()}. ${orgName}.`}
          description={`${new Date().toLocaleDateString('en-ZA', { weekday: 'long', month: 'long', day: 'numeric' })}.`}
          actions={(
            <>
              <ButtonLink href={scopedHref('/portal/projects')} size="sm">
                Request project
              </ButtonLink>
              <ButtonLink href={scopedHref('/portal/properties')} variant="secondary" size="sm">
                Set properties
              </ButtonLink>
            </>
          )}
        />

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {workspaceLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
          ) : (
            <>
              <StatCardWithChart
                label="Projects"
                value={projectTotal}
                sub={`${activeProjectTotal} active`}
                trend={activeProjectTotal > 0 ? 'up' : undefined}
              />
              <StatCardWithChart
                label="Posts published"
                value={socialStats?.byStatus.published ?? 0}
                sub={`${socialStats?.last30Days ?? 0} last 30d`}
                trend={hasLast30DaysData ? 'up' : undefined}
                data={hasLast30DaysData ? last30DaysData.map(d => ({ value: d.value })) : undefined}
                chartType="area"
              />
              <StatCardWithChart
                label="Pending approval"
                value={socialStats?.byStatus.pending_approval ?? 0}
              />
              <StatCardWithChart
                label="Approval rate"
                value={socialStats?.approvalRate ? `${Math.round(socialStats.approvalRate)}%` : '-'}
                sub="all time"
              />
            </>
          )}
        </div>

        <ScheduledContentPreviewCards
          slug={orgSlug}
          posts={scheduledPosts}
          loading={workspaceLoading || scheduledLoading}
          composeHref={scopedHref('/portal/social/compose')}
          description="Client-safe previews open into review or calendar."
          hrefForPost={(post) => (
            post.status === 'pending_approval' || post.status === 'client_review' || post.status === 'qa_review'
              ? scopedHref(`/portal/social/review/${post.id}`)
              : scopedHref(`/portal/social/calendar?postId=${post.id}`)
          )}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Surface className="space-y-2.5 lg:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon name="folder_managed" className="text-[var(--sc-ink-soft)]" />
                <p className="sc-tiny mb-0">Projects</p>
              </div>
              <Link href={scopedHref('/portal/projects')} className="sc-tiny text-[var(--sc-ink)] hover:underline">
                View all
              </Link>
            </div>

            {projectsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
              </div>
            ) : projects.length === 0 ? (
              <EmptyState
                title="No projects yet."
                description="Project updates will appear here once work has been opened for your workspace."
                action={<ButtonLink href={scopedHref('/portal/projects')} variant="secondary" size="sm">Request project</ButtonLink>}
              />
            ) : (
              <div className="-mx-4 space-y-0.5">
                {projects.slice(0, 6).map((project) => (
                  <Link
                    key={project.id}
                    href={scopedHref(`/portal/projects/${project.id}`)}
                    className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]"
                  >
                    <Icon name="view_kanban" className="shrink-0 text-[var(--sc-ink-soft)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate sc-body text-[var(--sc-ink)]">{project.name}</p>
                      {project.description ? (
                        <p className="mt-0.5 truncate sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{project.description}</p>
                      ) : null}
                    </div>
                    <Status tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Status>
                  </Link>
                ))}
              </div>
            )}
          </Surface>

          <Surface className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon name="donut_large" className="text-[var(--sc-ink-soft)]" />
              <p className="sc-tiny mb-0">Post status</p>
            </div>
            {socialLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : statusDonut.length > 0 ? (
              <DonutChart data={statusDonut} centerValue={socialStats?.total ?? 0} centerLabel="Total" />
            ) : (
              <div className="py-8 text-center sc-body text-[var(--sc-ink-soft)]">
                No social posts yet.
              </div>
            )}
          </Surface>
        </div>

        {!socialLoading && socialStats ? (
          <div className={`grid grid-cols-1 gap-4 ${platformBarData.length > 0 ? 'lg:grid-cols-2' : ''}`}>
            {platformBarData.length > 0 ? (
              <Surface className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon name="bar_chart" className="text-[var(--sc-ink-soft)]" />
                    <p className="sc-tiny mb-0">Platform breakdown</p>
                  </div>
                  <Link href={scopedHref('/portal/social')} className="sc-tiny text-[var(--sc-ink)] hover:underline">
                    View social
                  </Link>
                </div>
                <HorizontalBarChart data={platformBarData} />
              </Surface>
            ) : null}

            <Surface className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon name="show_chart" className="text-[var(--sc-ink-soft)]" />
                  <div>
                    <p className="sc-tiny mb-0">Publishing trend</p>
                    <p className="st-num mt-0.5 text-[1.125rem] text-[var(--sc-ink)]">
                      {socialStats.last30Days} posts
                    </p>
                  </div>
                </div>
                <Status>Last 30 days</Status>
              </div>
              {hasLast30DaysData ? (
                <TrendAreaChart data={last30DaysData} height={140} color="var(--sc-ink)" />
              ) : (
                <div className="flex h-32 items-center justify-center sc-body text-[var(--sc-ink-soft)]">
                  No posts in the last 30 days.
                </div>
              )}
            </Surface>
          </div>
        ) : null}

        <Surface variant="quiet">
          <p className="sc-tiny mb-2">Quick actions</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Projects', href: scopedHref('/portal/projects') },
              { label: 'Messages', href: scopedHref('/portal/messages') },
              { label: 'Properties', href: scopedHref('/portal/properties') },
              { label: 'Reports', href: scopedHref('/portal/reports') },
              { label: 'Marketing', href: scopedHref('/portal/marketing') },
              { label: 'Team', href: scopedHref('/portal/settings/team') },
            ].map(a => (
              <ButtonLink key={a.href} href={a.href} variant="secondary" size="sm">{a.label}</ButtonLink>
            ))}
          </div>
        </Surface>
      </section>

      {/* Campaigns section */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="sc-tiny">Campaigns</h2>
          <Link
            href={scopedHref('/portal/campaigns')}
            className="inline-flex items-center gap-1 sc-tiny text-[var(--sc-ink-soft)] transition-colors hover:text-[var(--sc-ink)]"
          >
            All campaigns
            <Icon name="arrow_outward" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link href={scopedHref('/portal/contacts')} className="block transition-colors hover:border-[var(--sc-ink)]">
            <StatCard
              label="Contacts"
              value={stats.contacts === null ? '-' : fmtNum.format(stats.contacts)}
              detail="total in your audience"
              icon="contacts"
            />
          </Link>

          <Link href={scopedHref('/portal/campaigns')} className="block transition-colors hover:border-[var(--sc-ink)]">
            <StatCard
              label="Active campaigns"
              value={stats.activeCampaigns === null ? '-' : fmtNum.format(stats.activeCampaigns)}
              detail="running right now"
              icon="campaign"
            />
          </Link>

          <Link href={scopedHref('/portal/capture-sources')} className="block transition-colors hover:border-[var(--sc-ink)]">
            <StatCard
              label="Capture sources"
              value={stats.captureSources === null ? '-' : fmtNum.format(stats.captureSources)}
              detail="funneling leads in"
              icon="inventory_2"
            />
          </Link>
        </div>
      </section>

      <TopCompaniesByPipelineTile orgScope={orgScope} />

      {!crmLoading && crmData ? (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="sc-tiny">Pipeline</h2>
            <Link
              href={scopedHref('/portal/deals')}
              className="inline-flex items-center gap-1 sc-tiny text-[var(--sc-ink-soft)] transition-colors hover:text-[var(--sc-ink)]"
            >
              View deals
              <Icon name="arrow_outward" />
            </Link>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Open deals"
              value={crmData.openDealsCount}
              detail={formatCurrency(crmData.openDealsValue)}
              icon="handshake"
            />
            <StatCard
              label="Weighted pipeline"
              value={formatCurrency(crmData.weightedPipelineValue)}
              icon="account_balance_wallet"
            />
            <StatCard
              label="Won this month"
              value={crmData.wonThisMonth.count}
              detail={formatCurrency(crmData.wonThisMonth.value)}
              icon="emoji_events"
            />
            <StatCard
              label="Lost this month"
              value={crmData.lostThisMonth.count}
              icon="trending_down"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Surface>
              <p className="sc-tiny mb-3">Recent activity</p>
              {crmData.recentActivities.length === 0 ? (
                <p className="sc-body text-[var(--sc-ink-soft)]">No recent activity.</p>
              ) : (
                crmData.recentActivities.map(a => {
                  const href = crmActivityHref(a)
                  const content = (
                    <>
                      <Icon name={activityIcon(a.type)} className="mt-0.5 shrink-0 text-[var(--sc-ink-soft)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate sc-body">{a.summary ?? a.type}</p>
                        <p className="sc-tiny text-[var(--sc-ink-soft)]">
                          {a.createdByRef?.displayName ?? ''}
                          {a.createdByRef?.displayName && a.createdAt ? ' · ' : ''}
                          {fmtTimestamp(a.createdAt)}
                        </p>
                      </div>
                    </>
                  )
                  const className = 'flex items-start gap-2 border-b border-[var(--sc-line)] py-1.5 last:border-0 transition-colors hover:text-[var(--sc-ink)]'
                  return href ? (
                    <Link key={a.id} href={scopedHref(href)} className={className}>
                      {content}
                    </Link>
                  ) : (
                    <div key={a.id} className="flex items-start gap-2 border-b border-[var(--sc-line)] py-1.5 last:border-0">
                      {content}
                    </div>
                  )
                })
              )}
            </Surface>

            <Surface>
              <p className="sc-tiny mb-3">Top open deals</p>
              <Table>
                <THead>
                  <TR>
                    <TH>Deal</TH>
                    <TH className="text-right">Value</TH>
                    <TH className="text-right">Prob</TH>
                  </TR>
                </THead>
                <tbody>
                  {crmData.topOpenDeals.length === 0 ? (
                    <TR>
                      <TD colSpan={3} className="py-3 text-center text-[var(--sc-ink-soft)]">No open deals</TD>
                    </TR>
                  ) : (
                    crmData.topOpenDeals.map(d => (
                      <TR key={d.id}>
                        <TD>
                          <Link href={scopedHref(`/portal/deals/${encodeURIComponent(d.id)}`)} className="hover:underline">
                            {d.title ?? '-'}
                          </Link>
                        </TD>
                        <TD className="st-num text-right">{formatCurrency(d.value ?? 0, d.currency)}</TD>
                        <TD className="text-right text-[var(--sc-ink-soft)]">{d.probability ?? '-'}%</TD>
                      </TR>
                    ))
                  )}
                </tbody>
              </Table>
            </Surface>
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {noData ? (
        <EmptyState
          title="No data yet."
          description="Once your team connects integrations, KPIs will appear here within 24 hours."
          action={(
            <ButtonLink href={scopedHref('/portal/properties')} variant="secondary" size="sm">
              Manage properties
            </ButtonLink>
          )}
        />
      ) : null}

      {!loading && data && data.connections.length > 0 ? (
        <>
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="sc-tiny">Headline metrics</h2>
              <span className="sc-tiny text-[var(--sc-ink-soft)]">Month to date</span>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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

          {data.reports.length > 0 ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="sc-tiny">Latest report</h2>
                <Link href={scopedHref('/portal/reports')} className="inline-flex items-center gap-1 sc-tiny text-[var(--sc-ink-soft)] transition-colors hover:text-[var(--sc-ink)]">
                  All reports
                  <Icon name="arrow_outward" />
                </Link>
              </div>
              <Surface className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="st-title text-[var(--sc-ink)]">
                    {data.reports[0].period.start} to {data.reports[0].period.end}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Status>{data.reports[0].type}</Status>
                    <StatusPill tone={data.reports[0].status === 'sent' ? 'success' : 'neutral'}>
                      {data.reports[0].status}
                    </StatusPill>
                    <span className="sc-tiny text-[var(--sc-ink-soft)]">
                      Total revenue {fmtZar.format(data.reports[0].kpis.total_revenue)} · MRR {fmtZar.format(data.reports[0].kpis.mrr)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {data.reports[0].publicToken ? (
                    <ButtonLink
                      href={`/reports/${data.reports[0].publicToken}`}
                      size="sm"
                    >
                      Open report
                      <Icon name="arrow_outward" />
                    </ButtonLink>
                  ) : null}
                </div>
              </Surface>
            </section>
          ) : null}

          {data.properties.length > 0 ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="sc-tiny">Your properties</h2>
                <Link href={scopedHref('/portal/properties')} className="inline-flex items-center gap-1 sc-tiny text-[var(--sc-ink-soft)] transition-colors hover:text-[var(--sc-ink)]">
                  Manage
                  <Icon name="arrow_outward" />
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {data.properties.slice(0, 3).map((p) => {
                  const conns = data.connections.filter((c) => c.propertyId === p.id)
                  return (
                    <Surface key={p.id} className="flex items-start gap-3">
                      <Icon name="language" className="shrink-0 text-[var(--sc-ink-soft)]" />
                      <div className="min-w-0">
                        <p className="sc-tiny">{p.type}</p>
                        <p className="st-title mt-1 text-[var(--sc-ink)]">{p.name}</p>
                        <p className="mt-1.5 sc-tiny text-[var(--sc-ink-soft)]">
                          {conns.length} connection{conns.length === 1 ? '' : 's'}
                        </p>
                      </div>
                    </Surface>
                  )
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
