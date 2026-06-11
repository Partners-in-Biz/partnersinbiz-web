'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { resolvePlatformAgentBoardHref } from '@/lib/admin/dashboard-links'
import { PageHeader, PageTabs, Surface, StatusPill } from '@/components/ui/AppFoundation'

type OrgSummary = {
  id: string
  name: string
  slug?: string
  status?: string
  type?: string
  memberCount?: number
  website?: string
}

type AgentTask = {
  id: string
  orgId?: string
  title: string
  projectName?: string | null
  assigneeAgentId?: string | null
  agentStatus?: string | null
  columnId?: string | null
  reviewStatus?: string | null
  priority?: string | null
  href?: string
  updatedAt?: string | null
  createdAt?: string | null
}

type Approval = {
  id: string
  content?: string
  platform?: string
  orgId?: string
  orgName?: string
  scheduledAt?: string | null
}

type Activity = {
  id: string
  type?: string
  note?: string
  description?: string
  entityTitle?: string
  createdAt?: string | null
}

type Health = {
  ok?: boolean
  timestamp?: string
  services?: Record<string, string>
}

type LoadState = {
  orgs: OrgSummary[]
  tasks: AgentTask[]
  approvals: Approval[]
  activity: Activity[]
  health: Health | null
}

const initialState: LoadState = {
  orgs: [],
  tasks: [],
  approvals: [],
  activity: [],
  health: null,
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  'picked-up': 'Picked up',
  'in-progress': 'In progress',
  'awaiting-input': 'Awaiting input',
  blocked: 'Blocked',
  done: 'Done',
}

const WORK_LANES = [
  { id: 'attention', title: 'Needs attention', icon: 'priority_high', color: '#f59e0b' },
  { id: 'active', title: 'In progress', icon: 'autorenew', color: 'var(--color-accent-v2)' },
  { id: 'approval', title: 'Approvals', icon: 'rate_review', color: '#c084fc' },
] as const

const SOFTWARE_BUILD_LANES = [
  { id: 'pending', title: 'Pending', icon: 'pending_actions', color: '#fbbf24' },
  { id: 'in-progress', title: 'In progress', icon: 'construction', color: '#60a5fa' },
  { id: 'blocked', title: 'Blocked', icon: 'report_problem', color: '#fb7185' },
  { id: 'review', title: 'Review', icon: 'rate_review', color: '#c084fc' },
  { id: 'completed', title: 'Completed', icon: 'task_alt', color: '#34d399' },
] as const

type WorkLaneConfig = { id: string; title: string; icon: string; color: string }

const RISK_STATUSES = new Set(['blocked', 'awaiting-input'])
const ACTIVE_STATUSES = new Set(['pending', 'picked-up', 'in-progress'])
const PULSE_STATUSES = new Set(['pending', 'picked-up', 'in-progress', 'awaiting-input', 'blocked'])

function dataFrom<T>(body: unknown, fallback: T): T {
  if (!body || typeof body !== 'object') return fallback
  const record = body as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data as T
  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>
    if (Array.isArray(data.cards)) return data.cards as T
    if (Array.isArray(data.items)) return data.items as T
    return data as T
  }
  if (Array.isArray(record.cards)) return record.cards as T
  return fallback
}

async function fetchJson(url: string) {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `Request failed: ${url}`)
  }
  return body
}

function formatRelative(value?: string | null) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  const diff = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return date.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' })
}

function healthTone(health: Health | null, error: string | null) {
  if (error) return 'border-red-400/30 bg-red-500/10 text-red-200'
  if (!health) return 'border-slate-500/30 bg-slate-500/10 text-on-surface-variant'
  return health.ok === false ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
}

function orgDashboardHref(org: Pick<OrgSummary, 'slug'>) {
  return org.slug ? `/admin/org/${org.slug}/dashboard` : '/admin/clients'
}

function clientOrgs(orgs: OrgSummary[]) {
  return orgs.filter(org => org.type !== 'platform_owner')
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-card-border)] bg-[var(--color-surface-container)]/40 px-5 py-8 text-center">
      <p className="text-sm font-label text-on-surface">{title}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{body}</p>
    </div>
  )
}

function SectionHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{eyebrow}</p>}
        <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">{title}</h2>
      </div>
      {action}
    </div>
  )
}

function dashboardTone(value: number, goodWhenZero = false): 'success' | 'warn' | 'accent' {
  if (goodWhenZero) return value === 0 ? 'success' : 'warn'
  return value > 0 ? 'accent' : 'success'
}

function softColor(color: string, opacity = 14) {
  const alpha = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0')
  return color.startsWith('var(') ? `color-mix(in oklab, ${color} ${opacity}%, transparent)` : `${color}${alpha}`
}

function softwareBuildLane(task: AgentTask): (typeof SOFTWARE_BUILD_LANES)[number]['id'] {
  const status = task.agentStatus ?? ''
  const column = task.columnId ?? ''
  if (column === 'review') return 'review'
  if (column === 'done' || status === 'done') return 'completed'
  if (column === 'blocked' || status === 'blocked' || status === 'awaiting-input') return 'blocked'
  if (status === 'in-progress' || status === 'picked-up' || column === 'in_progress') return 'in-progress'
  return 'pending'
}

function taskMeta(task: AgentTask) {
  const status = STATUS_LABELS[task.agentStatus ?? ''] ?? task.agentStatus ?? 'Queued'
  const project = task.projectName ?? 'No project title'
  const assignee = task.assigneeAgentId ?? 'agent'
  return `${project} · ${assignee} · ${status} · ${formatRelative(task.updatedAt ?? task.createdAt)}`
}

function MetricCard({
  label,
  value,
  icon,
  tone = 'accent',
  detail,
}: {
  label: string
  value: number
  icon: string
  tone?: 'accent' | 'success' | 'warn' | 'danger'
  detail: string
}) {
  const toneClass = {
    accent: 'text-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] border-[var(--color-pib-accent)]/20',
    success: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20',
    warn: 'text-amber-200 bg-amber-500/10 border-amber-400/25',
    danger: 'text-red-300 bg-red-500/10 border-red-400/25',
  }[tone]

  return (
    <Surface className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
          <p className="mt-3 text-3xl font-headline font-bold leading-none text-on-surface">{value}</p>
        </div>
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${toneClass}`}>
          <span className="material-symbols-outlined text-[21px]">{icon}</span>
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-on-surface-variant">{detail}</p>
    </Surface>
  )
}

function DashboardQuickLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] px-3 py-2 text-xs font-label uppercase tracking-wide text-on-surface-variant transition-colors hover:border-[var(--color-pib-accent)]/50 hover:text-on-surface"
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      {label}
    </Link>
  )
}

function WorkItemCard({
  title,
  meta,
  href,
  color,
  icon,
  priority,
}: {
  title: string
  meta: string
  href: string
  color: string
  icon: string
  priority?: string | null
}) {
  return (
    <Link
      href={href}
      className="pib-card group block p-3 transition-all duration-150 hover:border-[var(--color-accent-v2)]"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ color, background: softColor(color, 10), border: `1px solid ${softColor(color, 18)}` }}
        >
          <span className="material-symbols-outlined text-[16px]">{icon}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block line-clamp-2 text-sm font-medium leading-snug text-on-surface group-hover:text-[var(--color-pib-accent-hover)]">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-on-surface-variant">{meta}</span>
        </span>
      </div>
      {priority ? (
        <div className="mt-3 flex justify-end">
          <span className="rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[9px] font-label uppercase tracking-wide text-on-surface-variant">{priority}</span>
        </div>
      ) : null}
    </Link>
  )
}

function WorkLane({
  lane,
  children,
  count,
}: {
  lane: WorkLaneConfig
  children: React.ReactNode
  count: number
}) {
  return (
    <div className="flex min-h-[360px] min-w-0 flex-col rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/55 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: lane.color }} />
          <span className="truncate text-xs font-label uppercase tracking-widest text-on-surface-variant">{lane.title}</span>
        </div>
        <span className="rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-[10px] font-label text-on-surface-variant">{count}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </div>
  )
}

function SoftwareBuildEmptyIndicator({ activeCount }: { activeCount: number }) {
  if (activeCount > 0) return null
  const specHref = `/portal/documents/new?orgId=${encodeURIComponent(PIB_PLATFORM_ORG_ID)}&type=build_spec&title=${encodeURIComponent('PiB Platform Build Spec — Next Approved Sprint')}`
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-50">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-label uppercase tracking-widest text-amber-200">
            <span className="material-symbols-outlined text-[18px]">playlist_add_check</span>
            No active software build tickets
          </p>
          <p className="mt-2 leading-6 text-amber-50/90">
            The approved platform sprint has no pending or in-progress Theo build tickets. Create a build spec first, get Peet approval, then release gated implementation tasks instead of leaving the queue blank.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={specHref} className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] bg-amber-300 px-3 py-2 text-xs font-label uppercase tracking-wide text-slate-950 hover:bg-amber-200">
            Create gated build spec
            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
          </Link>
          <Link href="/portal/projects" className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] border border-amber-300/40 px-3 py-2 text-xs font-label uppercase tracking-wide text-amber-100 hover:border-amber-200">
            Open Projects/Kanban
          </Link>
        </div>
      </div>
    </div>
  )
}

function DashboardLoadingShell() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="pib-page-header">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="eyebrow">Admin / Dashboard</div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="pib-skeleton h-10 w-72 max-w-full rounded-lg" />
              <div className="pib-skeleton mt-3 h-4 w-[520px] max-w-full rounded" />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="pib-skeleton h-9 w-28 rounded-[var(--radius-btn)]" />
              <div className="pib-skeleton h-9 w-32 rounded-[var(--radius-btn)]" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
      <p className="sr-only" aria-live="polite">Dashboard is loading</p>
    </div>
  )
}

function OrganisationCard({ org, tasks, approvals }: { org: OrgSummary; tasks: AgentTask[]; approvals: Approval[] }) {
  const riskyTasks = tasks.filter(task => RISK_STATUSES.has(task.agentStatus ?? '')).length
  const activeTasks = tasks.filter(task => ACTIVE_STATUSES.has(task.agentStatus ?? '')).length
  const score = Math.max(35, Math.min(100, 95 - riskyTasks * 20 - approvals.length * 8))
  const href = orgDashboardHref(org)
  const needsAttention = riskyTasks > 0 || approvals.length > 0
  const rail = needsAttention ? '#f59e0b' : activeTasks > 0 ? 'var(--color-accent-v2)' : '#4ade80'
  const statusLabel = needsAttention ? 'Attention' : activeTasks > 0 ? 'Active' : 'Steady'

  return (
    <Link href={href} className="group/card relative flex min-h-[174px] overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-pib-accent)]/60 hover:shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: rail }} />
      <div className="flex min-w-0 flex-1 flex-col p-5 pl-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-headline font-semibold leading-snug text-on-surface group-hover/card:text-[var(--color-pib-accent-hover)]">{org.name}</h3>
            <p className="mt-1 text-xs text-on-surface-variant">{org.type ?? 'client'} · {org.status ?? 'active'}</p>
          </div>
          <StatusPill tone={needsAttention ? 'warn' : activeTasks > 0 ? 'accent' : 'success'} dot>
            {statusLabel}
          </StatusPill>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Workspace health</span>
            <span className="font-mono text-[11px] text-on-surface-variant">{score}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${score}%`, background: rail }} />
          </div>
        </div>

        <div className="mt-auto grid grid-cols-3 gap-2 pt-5 text-xs">
          <div>
            <p className="font-mono text-lg font-semibold text-on-surface">{activeTasks}</p>
            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Tasks</p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-on-surface">{approvals.length}</p>
            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Approvals</p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-on-surface">{org.memberCount ?? 0}</p>
            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Team</p>
          </div>
        </div>
      </div>
    </Link>
  )
}

function TimelineItem({ item }: { item: Activity | AgentTask }) {
  const isTask = 'title' in item
  const title = isTask
    ? item.title
    : (item.note ?? item.description ?? item.entityTitle ?? item.type ?? 'Activity')
  const meta = isTask ? `${item.assigneeAgentId ?? 'agent'} · ${STATUS_LABELS[item.agentStatus ?? ''] ?? item.agentStatus ?? 'Queued'}` : (item.type ?? 'activity').replace(/_/g, ' ')
  const when = isTask ? formatRelative(item.updatedAt ?? item.createdAt) : formatRelative(item.createdAt)
  return (
    <div className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-[var(--color-accent-v2)] bg-[var(--color-card)]" />
      <p className="text-sm text-on-surface">{title}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{meta} · {when}</p>
    </div>
  )
}

export default function MissionControlDashboard() {
  const [data, setData] = useState<LoadState>(initialState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [dashboardView, setDashboardView] = useState<'overview' | 'work'>('overview')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setHealthError(null)
      try {
        const [orgsResult, tasksResult, approvalsResult, activityResult, healthResult] = await Promise.allSettled([
          fetchJson('/api/v1/organizations'),
          fetchJson(`/api/v1/admin/agent-tasks?orgId=${encodeURIComponent(PIB_PLATFORM_ORG_ID)}&assigneeAgentId=theo`),
          fetchJson('/api/v1/social/posts/pending?limit=12'),
          fetchJson('/api/v1/dashboard/activity?limit=12'),
          fetchJson('/api/v1/health'),
        ])

        if (cancelled) return

        const next: LoadState = { ...initialState }
        if (orgsResult.status === 'fulfilled') next.orgs = dataFrom<OrgSummary[]>(orgsResult.value, [])
        if (tasksResult.status === 'fulfilled') next.tasks = dataFrom<AgentTask[]>(tasksResult.value, [])
        if (approvalsResult.status === 'fulfilled') next.approvals = dataFrom<Approval[]>(approvalsResult.value, [])
        if (activityResult.status === 'fulfilled') next.activity = dataFrom<Activity[]>(activityResult.value, [])
        if (healthResult.status === 'fulfilled') next.health = dataFrom<Health>(healthResult.value, healthResult.value as Health)
        if (healthResult.status === 'rejected') setHealthError(healthResult.reason instanceof Error ? healthResult.reason.message : 'Health unavailable')

        const failures = [orgsResult, tasksResult, approvalsResult, activityResult]
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map(result => result.reason instanceof Error ? result.reason.message : 'Request failed')
        setData(next)
        setError(failures.length > 0 ? failures.join(' · ') : null)
      } catch (err) {
        if (!cancelled) {
          setData(initialState)
          setError(err instanceof Error ? err.message : 'Dashboard unavailable')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const visibleOrgs = useMemo(() => clientOrgs(data.orgs), [data.orgs])
  const activeTasks = useMemo(() => data.tasks.filter(task => ACTIVE_STATUSES.has(task.agentStatus ?? '')), [data.tasks])
  const pulseTasks = useMemo(() => data.tasks.filter(task => PULSE_STATUSES.has(task.agentStatus ?? '')), [data.tasks])
  const riskTasks = useMemo(() => pulseTasks.filter(task => RISK_STATUSES.has(task.agentStatus ?? '')), [pulseTasks])
  const timeline = useMemo(() => [...pulseTasks.slice(0, 4), ...data.activity.slice(0, 5)].slice(0, 8), [pulseTasks, data.activity])
  const serviceEntries = Object.entries(data.health?.services ?? {})
  const approvalLaneItems = data.approvals.slice(0, 6)
  const activeLaneItems = pulseTasks.filter(task => !RISK_STATUSES.has(task.agentStatus ?? '')).slice(0, 6)
  const softwareBuildTasks = useMemo(() => data.tasks.filter(task => task.assigneeAgentId === 'theo'), [data.tasks])
  const activeSoftwareBuildTasks = useMemo(
    () => softwareBuildTasks.filter(task => {
      const lane = softwareBuildLane(task)
      return lane === 'pending' || lane === 'in-progress'
    }),
    [softwareBuildTasks],
  )
  const agentBoardHref = useMemo(() => resolvePlatformAgentBoardHref(data.orgs), [data.orgs])

  if (!hydrated) return <DashboardLoadingShell />

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <PageHeader
        eyebrow="Admin / Dashboard"
        title="Operating dashboard"
        description="Platform control plane — agent work, client health, approvals, and platform movement."
        actions={(
          <>
            <DashboardQuickLink href="/portal/projects" icon="folder_managed" label="Projects" />
            <DashboardQuickLink href={agentBoardHref} icon="view_kanban" label="Agent board" />
          </>
        )}
        tabs={(
          <PageTabs
            variant="segmented"
            value={dashboardView}
            onValueChange={(value) => setDashboardView(value as 'overview' | 'work')}
            ariaLabel="Dashboard view"
            tabs={[
              { label: 'Overview', value: 'overview', icon: 'space_dashboard' },
              { label: 'Work board', value: 'work', icon: 'view_kanban', badge: pulseTasks.length },
            ]}
          />
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Clients" value={visibleOrgs.length} icon="groups" detail="Active client workspaces across the platform." />
        <MetricCard label="Active tasks" value={activeTasks.length} icon="task_alt" detail="Queued or moving agent and delivery tasks." />
        <MetricCard label="Approvals" value={data.approvals.length} icon="rate_review" tone={dashboardTone(data.approvals.length, true)} detail="Human review items waiting in the queue." />
        <MetricCard label="At risk" value={riskTasks.length} icon="report" tone={riskTasks.length > 0 ? 'warn' : 'success'} detail="Blocked or awaiting-input work that needs attention." />
      </div>

      {error && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Some dashboard feeds could not load: {error}. Showing everything that is available.
        </div>
      )}

      {dashboardView === 'overview' ? (
        <>
          <section className="space-y-4">
            <SectionHeader title="Client workspaces" eyebrow="Portfolio" action={<Link href="/admin/clients" className="inline-flex items-center gap-1 text-xs font-label uppercase tracking-wide text-[var(--color-accent-v2)]">Manage clients <span className="material-symbols-outlined text-[15px]">arrow_forward</span></Link>} />
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-48 rounded-lg" /><Skeleton className="h-48 rounded-lg" /><Skeleton className="h-48 rounded-lg" /></div>
            ) : visibleOrgs.length === 0 ? (
              <EmptyState title="No active organisations" body="Create or activate a client organisation and its command card will appear here." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleOrgs.map(org => (
                  <OrganisationCard key={org.id} org={org} tasks={pulseTasks.filter(task => task.orgId === org.id)} approvals={data.approvals.filter(item => item.orgId === org.id)} />
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <Surface className="p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <SectionHeader title="Service strip" eyebrow="Platform signal" />
                <div className={`rounded-full border px-3 py-1.5 text-xs ${healthTone(data.health, healthError)}`}>
                  {healthError ? `Health unavailable: ${healthError}` : data.health?.ok === false ? 'Service degradation detected' : data.health ? 'All core services reporting' : 'Checking services'}
                </div>
              </div>
              {loading ? (
                <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /></div>
              ) : serviceEntries.length === 0 ? (
                <EmptyState title="Health signal unavailable" body="The dashboard is still usable; service telemetry will appear here when the health endpoint responds." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {serviceEntries.map(([name, status]) => (
                    <div key={name} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)]/35 p-4">
                      <p className="text-xs uppercase tracking-wide text-on-surface-variant">{name}</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">{status}</p>
                    </div>
                  ))}
                </div>
              )}
            </Surface>

            <Surface className="p-4 sm:p-5">
              <SectionHeader title="Today timeline" eyebrow="Latest movement" />
              <div className="relative mt-5 space-y-5 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-[var(--color-card-border)]">
                {loading ? (
                  <><Skeleton className="h-12 rounded-lg" /><Skeleton className="h-12 rounded-lg" /><Skeleton className="h-12 rounded-lg" /></>
                ) : timeline.length === 0 ? (
                  <div className="before:hidden"><EmptyState title="Timeline is quiet" body="Activity, task movement, and handoffs will appear here throughout the day." /></div>
                ) : timeline.map(item => <TimelineItem key={item.id} item={item} />)}
              </div>
            </Surface>
          </div>
        </>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeader title="Work board" eyebrow="Kanban signal" />
            <Link href={agentBoardHref} className="inline-flex items-center gap-1 text-xs font-label uppercase tracking-wide text-[var(--color-accent-v2)]">Open full board <span className="material-symbols-outlined text-[15px]">arrow_forward</span></Link>
          </div>
          {loading ? (
            <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80 rounded-lg" /><Skeleton className="h-80 rounded-lg" /><Skeleton className="h-80 rounded-lg" /></div>
          ) : (
            <>
              <div className="space-y-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/40 p-4">
                <SectionHeader
                  title="Software build queue"
                  eyebrow="Theo / parent PiB workspace"
                  action={<span className="rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">{activeSoftwareBuildTasks.length} active / {softwareBuildTasks.length} total</span>}
                />
                <SoftwareBuildEmptyIndicator activeCount={activeSoftwareBuildTasks.length} />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {SOFTWARE_BUILD_LANES.map((lane) => {
                    const laneTasks = softwareBuildTasks.filter(task => softwareBuildLane(task) === lane.id)
                    return (
                      <WorkLane key={lane.id} lane={lane} count={laneTasks.length}>
                        {laneTasks.length === 0 ? (
                          <EmptyState title={`No ${lane.title.toLowerCase()} builds`} body="Software-build tasks in this state will appear here." />
                        ) : laneTasks.slice(0, 6).map(task => (
                          <WorkItemCard
                            key={task.id}
                            title={task.title}
                            meta={taskMeta(task)}
                            href={task.href ?? agentBoardHref}
                            color={lane.color}
                            icon={lane.icon}
                            priority={task.priority}
                          />
                        ))}
                      </WorkLane>
                    )
                  })}
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
              <WorkLane lane={WORK_LANES[0]} count={riskTasks.length}>
                {riskTasks.length === 0 ? (
                  <EmptyState title="No blockers" body="Blocked and awaiting-input tasks will collect here." />
                ) : riskTasks.slice(0, 6).map(task => (
                  <WorkItemCard
                    key={task.id}
                    title={task.title}
                    meta={taskMeta(task)}
                    href={task.href ?? agentBoardHref}
                    color={WORK_LANES[0].color}
                    icon={WORK_LANES[0].icon}
                    priority={task.priority}
                  />
                ))}
              </WorkLane>
              <WorkLane lane={WORK_LANES[1]} count={activeLaneItems.length}>
                {activeLaneItems.length === 0 ? (
                  <EmptyState title="No active pulses" body="Queued and in-progress work will appear here." />
                ) : activeLaneItems.map(task => (
                  <WorkItemCard
                    key={task.id}
                    title={task.title}
                    meta={taskMeta(task)}
                    href={task.href ?? agentBoardHref}
                    color={WORK_LANES[1].color}
                    icon={WORK_LANES[1].icon}
                    priority={task.priority}
                  />
                ))}
              </WorkLane>
              <WorkLane lane={WORK_LANES[2]} count={approvalLaneItems.length}>
                {approvalLaneItems.length === 0 ? (
                  <EmptyState title="Approval lane is clear" body="Social and deliverable approvals will collect here." />
                ) : approvalLaneItems.map(approval => (
                  <WorkItemCard
                    key={approval.id}
                    title={approval.content ?? 'Approval required'}
                    meta={`${approval.orgName ?? 'Organisation'} · ${approval.platform ?? 'approval'} · ${formatRelative(approval.scheduledAt)}`}
                    href="/portal/social/review"
                    color={WORK_LANES[2].color}
                    icon={WORK_LANES[2].icon}
                  />
                ))}
              </WorkLane>
            </div>
            </>
          )}
        </section>
      )}

      {loading && <p className="sr-only" aria-live="polite">Dashboard data is loading</p>}
      {loading && <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)]/40 px-4 py-3 text-sm text-on-surface-variant">Loading dashboard signal...</div>}
    </div>
  )
}
