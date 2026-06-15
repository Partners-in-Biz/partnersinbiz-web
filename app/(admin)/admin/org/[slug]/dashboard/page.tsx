'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { StatCardWithChart, DonutChart, HorizontalBarChart, TrendAreaChart } from '@/components/ui/Charts'
import { ScheduledContentPreviewCards, type ScheduledContentPost } from '@/components/social/ScheduledContentPreviewCards'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'

interface Project {
  id: string
  name: string
  status: string
  description?: string
  updatedAt?: unknown
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

interface OrganizationSummary {
  id: string
  slug: string
  name?: string
}

interface OrganizationSettings {
  portalModules?: Partial<Record<'mobileApps' | 'youtubeStudio' | 'bookStudio', boolean>>
  defaultApprovalRequired?: boolean
  timezone?: string
  preferredSendHourLocal?: number
  preferredSendDaysOfWeek?: number[]
  replyNotifyEmails?: string[]
}

interface OrganizationDetail {
  id: string
  name?: string
  settings?: OrganizationSettings
}

interface OrganizationMember {
  userId?: string
  displayName?: string
  email?: string
  role?: string
  accessScope?: string
}

interface AgentTaskCard {
  id: string
  title: string
  assigneeAgentId?: string | null
  agentStatus?: string | null
  projectName?: string | null
  href?: string | null
  updatedAt?: string | null
}

interface AgentTasksResponse {
  total?: number
  byStatus?: Record<string, number>
  cards?: AgentTaskCard[]
}

const PLATFORM_COLORS: Record<string, string> = {
  twitter: '#000000', x: '#000000',
  linkedin: '#0A66C2', facebook: '#1877F2',
  instagram: '#E4405F', tiktok: '#69C9D0',
  reddit: '#FF4500', pinterest: '#E60023',
  bluesky: '#0085FF', threads: '#555',
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active:      { label: 'Active',      color: 'var(--color-accent-v2)' },
    on_hold:     { label: 'On Hold',     color: 'var(--color-secondary)' },
    completed:   { label: 'Completed',   color: '#4ade80' },
    archived:    { label: 'Archived',    color: 'var(--color-outline)' },
    in_progress: { label: 'In Progress', color: 'var(--color-accent-v2)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--color-outline)' }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${s.color}20`, color: s.color }}
    >
      {s.label}
    </span>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayRange(): { from: string; to: string } {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

const PORTAL_MODULE_ROWS = [
  { key: 'mobileApps', label: 'Mobile Apps' },
  { key: 'youtubeStudio', label: 'YouTube Studio' },
  { key: 'bookStudio', label: 'Book Studio' },
] as const

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function titleCase(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function roleLabel(role?: string) {
  return role ? titleCase(role) : 'Unknown'
}

function statusLabel(status?: string | null) {
  return status ? titleCase(status) : 'Unassigned'
}

function normaliseScope(scope?: string) {
  return scope ? titleCase(scope) : 'Default workspace access'
}

export default function OrgDashboard() {
  const params = useParams()
  const slug = params.slug as string

  const [projects, setProjects] = useState<Project[]>([])
  const [socialStats, setSocialStats] = useState<SocialStats | null>(null)
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledContentPost[]>([])
  const [orgDetail, setOrgDetail] = useState<OrganizationDetail | null>(null)
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [agentTasks, setAgentTasks] = useState<AgentTasksResponse | null>(null)
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/organizations`)
      .then(r => r.json())
      .then(body => {
        const org = ((body.data ?? []) as OrganizationSummary[]).find((o) => o.slug === slug)
        if (!org) return null
        setOrgName(org.name?.trim() || '')
        return org.id
      })
      .then((fetchedOrgId) => {
        if (!fetchedOrgId) return undefined
        const headers = { 'X-Org-Id': fetchedOrgId, 'X-Org-Slug': slug }
        const orgQs = `orgId=${encodeURIComponent(fetchedOrgId)}`
        const { from, to } = todayRange()
        return Promise.all([
          fetch(`/api/v1/organizations/${encodeURIComponent(fetchedOrgId)}`, { headers })
            .then(r => r.json())
            .then(body => {
              setOrgDetail(body.data ?? body.organization ?? body.org ?? null)
            })
            .catch(() => {}),
          fetch(`/api/v1/organizations/${encodeURIComponent(fetchedOrgId)}/members`, { headers })
            .then(r => r.json())
            .then(body => {
              setMembers(body.data ?? body.members ?? [])
            })
            .catch(() => {}),
          fetch(`/api/v1/admin/agent-tasks?${orgQs}`, { headers })
            .then(r => r.json())
            .then(body => {
              setAgentTasks(body.data ?? body)
            })
            .catch(() => {}),
          fetch(`/api/v1/projects?view=received&${orgQs}`, { headers })
            .then(r => r.json())
            .then(body => {
              setProjects(body.data ?? [])
            })
            .catch(() => {}),
          fetch(`/api/v1/social/stats?${orgQs}`, { headers })
            .then(r => r.json())
            .then(body => setSocialStats(body.data ?? null))
            .catch(() => {}),
          fetch(`/api/v1/social/posts?${orgQs}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=50`, { headers })
            .then(r => r.json())
            .then(body => {
              const posts = ((body.data ?? []) as ScheduledContentPost[])
                .filter((post) => ['scheduled', 'approved', 'pending_approval', 'client_review', 'qa_review'].includes(post.status ?? ''))
              setScheduledPosts(posts)
            })
            .catch(() => {}),
        ])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

  const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'in_progress')
  const displayOrgName = orgName || slug.replace(/-/g, ' ')
  const settings = orgDetail?.settings ?? {}
  const portalModules = PORTAL_MODULE_ROWS.map((module) => ({
    ...module,
    enabled: settings.portalModules?.[module.key] !== false,
  }))
  const enabledPortalModules = portalModules.filter((module) => module.enabled).length
  const roleCounts = members.reduce<Record<string, number>>((counts, member) => {
    const role = member.role || 'unknown'
    counts[role] = (counts[role] ?? 0) + 1
    return counts
  }, {})
  const accessScopes = Array.from(new Set(members.map((member) => normaliseScope(member.accessScope)))).slice(0, 4)
  const sendDays = settings.preferredSendDaysOfWeek?.length
    ? settings.preferredSendDaysOfWeek.map((day) => DAY_LABELS[day] ?? String(day)).join(', ')
    : 'No send-day rule set'
  const sendHour = typeof settings.preferredSendHourLocal === 'number'
    ? `${String(settings.preferredSendHourLocal).padStart(2, '0')}:00`
    : 'No default send hour'
  const approvalGateLabel = settings.defaultApprovalRequired === true ? 'Required' : 'Optional'
  const taskCards = agentTasks?.cards ?? []
  const activeTaskCards = taskCards.filter((task) => !['done', 'completed', 'cancelled'].includes((task.agentStatus ?? '').toLowerCase()))
  const activeAgents = new Set(activeTaskCards.map((task) => task.assigneeAgentId).filter(Boolean)).size
  const statusEntries = Object.entries(agentTasks?.byStatus ?? {}).filter(([, count]) => count > 0)

  // Social post status donut data
  const statusDonut = socialStats ? [
    { name: 'Published', value: socialStats.byStatus.published, color: '#4ade80' },
    { name: 'Scheduled', value: socialStats.byStatus.scheduled, color: '#60a5fa' },
    { name: 'Pending', value: socialStats.byStatus.pending_approval, color: '#F59E0B' },
    { name: 'Draft', value: socialStats.byStatus.draft, color: '#666' },
  ].filter(d => d.value > 0) : []

  // Platform breakdown for horizontal bar
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
  const hasLast30DaysData = last30DaysData.some((point) => point.value > 0)

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Admin org dashboard"
        title={`${getGreeting()} — ${displayOrgName}`}
        description={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={(
          <Link href={`/admin/org/${slug}/projects`} className="pib-btn-primary text-sm font-label">
            + New operator project
          </Link>
        )}
        className="capitalize"
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Admin control plane
            </p>
            <h2 className="mt-1 text-xl font-headline font-bold text-on-surface">
              Control what the selected organisation can access and when work ships.
            </h2>
          </div>
          <Link href={`/admin/org/${slug}/settings`} className="pib-btn-secondary text-xs font-label">
            Configure controls
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="pib-card-section p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Client portal exposure</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {enabledPortalModules} of {PORTAL_MODULE_ROWS.length} client-facing modules enabled.
                </p>
              </div>
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">visibility</span>
            </div>
            <div className="mt-3 space-y-2">
              {portalModules.map((module) => (
                <div key={module.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-on-surface">{module.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-label uppercase tracking-wide ${
                      module.enabled
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-[var(--color-surface-container-high)] text-on-surface-variant'
                    }`}
                  >
                    {module.enabled ? 'Enabled' : 'Hidden'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pib-card-section p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Access and roles</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {members.length} people can use or administer this organisation.
                </p>
              </div>
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">groups</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {Object.entries(roleCounts).length > 0 ? Object.entries(roleCounts).map(([role, count]) => (
                <div key={role} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
                  <p className="text-lg font-headline font-bold text-on-surface">{count}</p>
                  <p className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                    {roleLabel(role)}
                  </p>
                </div>
              )) : (
                <p className="col-span-2 text-xs text-on-surface-variant">No member roster loaded yet.</p>
              )}
            </div>
            {accessScopes.length > 0 && (
              <p className="mt-3 text-xs text-on-surface-variant">
                Scopes: {accessScopes.join(', ')}
              </p>
            )}
          </div>

          <div className="pib-card-section p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Operating rules</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Approval gates and send windows that control client-side publishing.
                </p>
              </div>
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">rule_settings</span>
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-variant">Approval gate</dt>
                <dd className="font-medium text-on-surface">{approvalGateLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-variant">Send window</dt>
                <dd className="font-medium text-on-surface">{sendHour}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-variant">Send days</dt>
                <dd className="text-right font-medium text-on-surface">{sendDays}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-variant">Timezone</dt>
                <dd className="text-right font-medium text-on-surface">{settings.timezone || 'Default timezone'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-on-surface-variant">Reply alerts</dt>
                <dd className="font-medium text-on-surface">{settings.replyNotifyEmails?.length ?? 0}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Live operator workload
            </p>
            <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">
              Who is working on what right now
            </h2>
          </div>
          <Link href={`/admin/org/${slug}/agent/board`} className="pib-btn-secondary text-xs font-label">
            Open agent board
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="pib-card-section p-5">
            <p className="text-3xl font-headline font-bold text-on-surface">{activeTaskCards.length}</p>
            <p className="text-xs text-on-surface-variant">active tasks across {activeAgents} assigned operators</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {statusEntries.length > 0 ? statusEntries.map(([status, count]) => (
                <span key={status} className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-1 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                  {statusLabel(status)} {count}
                </span>
              )) : (
                <span className="text-xs text-on-surface-variant">No active status counts yet.</span>
              )}
            </div>
          </div>

          <div className="pib-card-section divide-y divide-[var(--color-card-border)] overflow-hidden p-0">
            {activeTaskCards.length > 0 ? activeTaskCards.slice(0, 5).map((task) => (
              <Link
                key={task.id}
                href={task.href || `/admin/org/${slug}/agent/board`}
                className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-[var(--color-row-hover)] md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-on-surface">{task.title}</p>
                  <p className="truncate text-xs text-on-surface-variant">
                    {task.projectName || 'No linked project'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
                  <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-1">
                    {task.assigneeAgentId || 'Unassigned'}
                  </span>
                  <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-1">
                    {statusLabel(task.agentStatus)}
                  </span>
                </div>
              </Link>
            )) : (
              <div className="px-4 py-6 text-sm text-on-surface-variant">
                No active operator work is assigned to this organisation yet.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCardWithChart
              label="Projects"
              value={projects.length}
              sub={`${activeProjects.length} active`}
              trend="up"
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

      <ScheduledContentPreviewCards slug={slug} posts={scheduledPosts} loading={loading} />

      {/* ── Projects + Social Status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Projects List */}
        <Surface className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Projects</p>
            <Link
              href={`/admin/org/${slug}/projects`}
              className="text-[10px] font-label uppercase tracking-wide"
              style={{ color: 'var(--color-accent-v2)' }}
            >
              View all →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : projects.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-on-surface-variant text-sm">No selected-org projects yet.</p>
              <Link
                href={`/admin/org/${slug}/projects`}
                className="text-sm mt-2 inline-block"
                style={{ color: 'var(--color-accent-v2)' }}
              >
                Create the first operator project →
              </Link>
            </div>
          ) : (
            <div className="space-y-1 -mx-6">
              {projects.slice(0, 6).map((project) => (
                <Link
                  key={project.id}
                  href={`/admin/org/${slug}/projects/${project.id}`}
                  className="flex items-center gap-4 px-6 py-3 hover:bg-[var(--color-row-hover)] transition-colors rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{project.name}</p>
                    {project.description && (
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">{project.description}</p>
                    )}
                  </div>
                  <StatusBadge status={project.status} />
                </Link>
              ))}
            </div>
          )}
        </Surface>

        {/* Social Status Donut */}
        <Surface className="space-y-2">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Post Status
          </p>
          {loading ? (
            <Skeleton className="h-[220px]" />
          ) : statusDonut.length > 0 ? (
            <DonutChart
              data={statusDonut}
              centerValue={socialStats?.total ?? 0}
              centerLabel="Total"
            />
          ) : (
            <div className="py-8 text-center text-sm text-on-surface-variant">
              No social posts yet.
            </div>
          )}
        </Surface>
      </div>

      {/* ── Social Analytics Row ── */}
      {!loading && socialStats && (
        <div className={`grid grid-cols-1 gap-4 ${platformBarData.length > 0 ? 'lg:grid-cols-2' : ''}`}>
          {/* Platform Breakdown */}
          {platformBarData.length > 0 && (
            <Surface className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Platform Breakdown
                </p>
                <Link
                  href={`/admin/org/${slug}/social`}
                  className="text-[10px] font-label uppercase tracking-wide"
                  style={{ color: 'var(--color-accent-v2)' }}
                >
                  View Social →
                </Link>
              </div>
              <HorizontalBarChart data={platformBarData} />
            </Surface>
          )}

          {/* Post Trend */}
          <Surface className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Publishing Trend
                </p>
                <p className="text-lg font-headline font-bold text-on-surface mt-0.5">
                  {socialStats.last30Days} posts
                </p>
              </div>
              <span className="text-[10px] text-on-surface-variant bg-[var(--color-surface-container)] px-2 py-1 rounded">
                Last 30 days
              </span>
            </div>
            {hasLast30DaysData ? (
              <TrendAreaChart data={last30DaysData} height={160} color="#4ade80" />
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-on-surface-variant">
                No posts in the last 30 days.
              </div>
            )}
          </Surface>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <Surface>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Quick Actions</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Projects',     href: `/admin/org/${slug}/projects` },
            { label: 'Social Queue', href: `/admin/org/${slug}/social` },
            { label: 'Compose Post', href: `/admin/org/${slug}/social/standalone` },
            { label: 'Team',         href: `/admin/org/${slug}/team` },
            { label: 'Billing',      href: `/admin/org/${slug}/billing` },
            { label: 'Analytics',    href: `/admin/org/${slug}/dashboard?panel=analytics` },
          ].map(a => (
            <Link key={a.href} href={a.href} className="pib-btn-secondary text-xs font-label">{a.label}</Link>
          ))}
        </div>
      </Surface>
    </div>
  )
}
