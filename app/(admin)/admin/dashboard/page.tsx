'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

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
  assigneeAgentId?: string | null
  agentStatus?: string | null
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

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
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

type ConstellationNode = OrgSummary & {
  x: number
  y: number
  tone: 'risk' | 'active' | 'calm'
}

function constellationNodes(orgs: OrgSummary[], tasks: AgentTask[], approvals: Approval[]): ConstellationNode[] {
  const fallback = orgs.length > 0 ? orgs : [{ id: 'platform', name: 'PiB Platform', slug: 'partners-in-biz' }]
  const centerX = 50
  const centerY = 50
  const radius = fallback.length < 4 ? 27 : 35

  return fallback.slice(0, 10).map((org, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(fallback.length, 3) - Math.PI / 2
    const orgTasks = tasks.filter(task => task.orgId === org.id)
    const hasRisk = orgTasks.some(task => RISK_STATUSES.has(task.agentStatus ?? '')) || approvals.some(approval => approval.orgId === org.id)
    const hasActive = orgTasks.some(task => ACTIVE_STATUSES.has(task.agentStatus ?? ''))

    return {
      ...org,
      x: Math.round((centerX + Math.cos(angle) * radius) * 10) / 10,
      y: Math.round((centerY + Math.sin(angle) * radius) * 10) / 10,
      tone: hasRisk ? 'risk' : hasActive ? 'active' : 'calm',
    }
  })
}

function MissionConstellation({ orgs, tasks, approvals }: { orgs: OrgSummary[]; tasks: AgentTask[]; approvals: Approval[] }) {
  const nodes = useMemo(() => constellationNodes(orgs, tasks, approvals), [orgs, tasks, approvals])
  const riskCount = nodes.filter(node => node.tone === 'risk').length
  const activeCount = nodes.filter(node => node.tone === 'active').length

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-[radial-gradient(circle_at_50%_20%,rgba(150,255,214,0.12),transparent_38%),var(--color-surface)] p-4 shadow-sm sm:p-5">
      <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-[0.25em] text-on-surface-variant">Motion layer: CSS/SVG</p>
          <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Organisation constellation</h2>
          <p className="mt-1 max-w-xl text-xs text-on-surface-variant">A lightweight radar map of client attention. Three.js deferred: the CSS/SVG layer keeps this fast, readable, and respectful of reduced-motion preferences.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-on-surface-variant">
          <span className="rounded-full bg-[var(--color-surface-container)] px-2.5 py-1">{nodes.length} nodes</span>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-100">{riskCount} risk</span>
          <span className="rounded-full bg-[var(--color-accent-subtle)] px-2.5 py-1" style={{ color: 'var(--color-accent-text)' }}>{activeCount} active</span>
        </div>
      </div>
      <div data-testid="mission-control-constellation" aria-hidden="true" className="relative mt-4 h-64 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" role="presentation" focusable="false">
          <circle cx="50" cy="50" r="16" className="fill-none stroke-[var(--color-border)]" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="32" className="fill-none stroke-[var(--color-border)]" strokeWidth="0.5" />
          <g className="origin-center motion-safe:animate-[pib-radar-spin_18s_linear_infinite]">
            <line x1="50" y1="50" x2="50" y2="10" stroke="var(--color-accent-v2)" strokeWidth="0.7" strokeLinecap="round" opacity="0.45" />
          </g>
          {nodes.map(node => (
            <line key={`line-${node.id}`} x1="50" y1="50" x2={node.x} y2={node.y} className="stroke-[var(--color-border)]" strokeWidth="0.45" opacity="0.85" />
          ))}
        </svg>
        {nodes.map((node, index) => (
          <span
            key={node.id}
            data-constellation-node="true"
            className={`absolute h-3 w-3 rounded-full shadow-[0_0_18px_currentColor] motion-safe:animate-[pib-node-float_5s_ease-in-out_infinite] ${node.tone === 'risk' ? 'bg-amber-300 text-amber-300' : node.tone === 'active' ? 'bg-[var(--color-accent-v2)] text-[var(--color-accent-v2)]' : 'bg-emerald-300 text-emerald-300'}`}
            style={{ left: `${node.x}%`, top: `${node.y}%`, animationDelay: `${index * 180}ms`, transform: 'translate(-50%, -50%)' }}
          />
        ))}
        <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-accent-v2)]/40 bg-[var(--color-surface)]/80 shadow-[0_0_40px_rgba(150,255,214,0.16)]" />
      </div>
    </div>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container)]/40 px-5 py-8 text-center">
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

function OrganisationCard({ org, tasks, approvals }: { org: OrgSummary; tasks: AgentTask[]; approvals: Approval[] }) {
  const riskyTasks = tasks.filter(task => RISK_STATUSES.has(task.agentStatus ?? '')).length
  const activeTasks = tasks.filter(task => ACTIVE_STATUSES.has(task.agentStatus ?? '')).length
  const score = Math.max(35, Math.min(100, 95 - riskyTasks * 20 - approvals.length * 8))
  const href = org.slug ? `/admin/org/${org.slug}` : '/admin/clients'

  return (
    <Link href={href} className="group block rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--color-accent-v2)]/50 hover:shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-headline font-bold text-on-surface">{org.name}</p>
          <p className="mt-1 text-xs text-on-surface-variant">{org.type ?? 'client'} · {org.status ?? 'active'}</p>
        </div>
        <div className="rounded-full px-2.5 py-1 text-[10px] font-label uppercase tracking-wide" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent-text)' }}>
          {score}% health
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--color-surface-container)]">
        <div className="h-full rounded-full bg-[var(--color-accent-v2)] transition-all" style={{ width: `${score}%` }} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-[var(--color-surface-container)]/60 px-2 py-3">
          <p className="text-lg font-bold text-on-surface">{activeTasks}</p>
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Tasks</p>
        </div>
        <div className="rounded-2xl bg-[var(--color-surface-container)]/60 px-2 py-3">
          <p className="text-lg font-bold text-on-surface">{approvals.length}</p>
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Approvals</p>
        </div>
        <div className="rounded-2xl bg-[var(--color-surface-container)]/60 px-2 py-3">
          <p className="text-lg font-bold text-on-surface">{org.memberCount ?? 0}</p>
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Team</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-on-surface-variant">
        {riskyTasks > 0 ? `${plural(riskyTasks, 'item')} needs attention` : 'Operating normally'}
      </p>
    </Link>
  )
}

function TaskPulseItem({ task }: { task: AgentTask }) {
  return (
    <Link href={task.href ?? '/admin/agent/board'} className="flex items-start gap-3 rounded-2xl px-3 py-3 transition hover:bg-[var(--color-row-hover)]">
      <span className={`mt-1 h-2.5 w-2.5 rounded-full ${RISK_STATUSES.has(task.agentStatus ?? '') ? 'bg-amber-400' : task.agentStatus === 'done' ? 'bg-emerald-400' : 'bg-[var(--color-accent-v2)]'}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-on-surface">{task.title}</span>
        <span className="mt-1 block text-xs text-on-surface-variant">{task.assigneeAgentId ?? 'agent'} · {STATUS_LABELS[task.agentStatus ?? ''] ?? task.agentStatus ?? 'Queued'} · {formatRelative(task.updatedAt ?? task.createdAt)}</span>
      </span>
      {task.priority && <span className="rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[10px] uppercase tracking-wide text-on-surface-variant">{task.priority}</span>}
    </Link>
  )
}

function ApprovalRadarItem({ approval }: { approval: Approval }) {
  return (
    <Link href="/admin/social/queue" className="flex items-start gap-3 rounded-2xl px-3 py-3 transition hover:bg-[var(--color-row-hover)]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent-text)' }}>
        {(approval.platform ?? 'A').slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs uppercase tracking-wide text-on-surface-variant">{approval.orgName ?? 'Organisation'} · {approval.platform ?? 'approval'}</span>
        <span className="mt-1 block line-clamp-2 text-sm text-on-surface">{approval.content ?? 'Approval required'}</span>
      </span>
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
      <span className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-[var(--color-accent-v2)] bg-[var(--color-surface)]" />
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

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setHealthError(null)
      try {
        const [orgsResult, tasksResult, approvalsResult, activityResult, healthResult] = await Promise.allSettled([
          fetchJson('/api/v1/organizations'),
          fetchJson('/api/v1/admin/agent-tasks?assigneeAgentId=theo'),
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
        if (healthResult.status === 'fulfilled') next.health = healthResult.value as Health
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

  const activeTasks = useMemo(() => data.tasks.filter(task => ACTIVE_STATUSES.has(task.agentStatus ?? '')), [data.tasks])
  const pulseTasks = useMemo(() => data.tasks.filter(task => PULSE_STATUSES.has(task.agentStatus ?? '')), [data.tasks])
  const riskTasks = useMemo(() => pulseTasks.filter(task => RISK_STATUSES.has(task.agentStatus ?? '')), [pulseTasks])
  const timeline = useMemo(() => [...pulseTasks.slice(0, 4), ...data.activity.slice(0, 5)].slice(0, 8), [pulseTasks, data.activity])
  const serviceEntries = Object.entries(data.health?.services ?? {})

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-[radial-gradient(circle_at_top_left,rgba(150,255,214,0.16),transparent_35%),var(--color-surface)] p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-label uppercase tracking-[0.3em] text-on-surface-variant">Mission control</p>
            <h1 className="mt-2 text-3xl font-headline font-bold text-on-surface sm:text-4xl">Today’s operating picture</h1>
            <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">A cross-client view of organisation health, active work, approvals waiting on humans, and the latest command timeline.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
            <div className="rounded-2xl bg-[var(--color-surface-container)]/70 p-3 text-center">
              <p className="text-2xl font-bold text-on-surface">{data.orgs.length}</p>
              <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Orgs</p>
            </div>
            <div className="rounded-2xl bg-[var(--color-surface-container)]/70 p-3 text-center">
              <p className="text-2xl font-bold text-on-surface">{activeTasks.length}</p>
              <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Tasks</p>
            </div>
            <div className="rounded-2xl bg-[var(--color-surface-container)]/70 p-3 text-center">
              <p className="text-2xl font-bold text-on-surface">{data.approvals.length}</p>
              <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Approvals</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Some dashboard feeds could not load: {error}. Showing everything that is available.
        </div>
      )}

      <MissionConstellation orgs={data.orgs} tasks={pulseTasks} approvals={data.approvals} />

      <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader title="Health strip" eyebrow="Platform signal" />
          <div className={`rounded-full border px-3 py-1.5 text-xs ${healthTone(data.health, healthError)}`}>
            {healthError ? `Health unavailable: ${healthError}` : data.health?.ok === false ? 'Service degradation detected' : data.health ? 'All core services reporting' : 'Checking services'}
          </div>
        </div>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : serviceEntries.length === 0 ? (
          <EmptyState title="Health signal unavailable" body="The dashboard is still usable; service telemetry will appear here when the health endpoint responds." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {serviceEntries.map(([name, status]) => (
              <div key={name} className="rounded-2xl bg-[var(--color-surface-container)]/50 p-4">
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">{name}</p>
                <p className="mt-2 text-lg font-bold text-on-surface">{status}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader title="Organisation cards" eyebrow="Client fleet" action={<Link href="/admin/clients" className="text-xs font-label uppercase tracking-wide" style={{ color: 'var(--color-accent-v2)' }}>Manage clients →</Link>} />
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
        ) : data.orgs.length === 0 ? (
          <EmptyState title="No active organisations" body="Create or activate a client organisation and its command card will appear here." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.orgs.slice(0, 9).map(org => (
              <OrganisationCard key={org.id} org={org} tasks={pulseTasks.filter(task => task.orgId === org.id)} approvals={data.approvals.filter(item => item.orgId === org.id)} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 lg:col-span-1">
          <SectionHeader title="Task pulse" eyebrow={`${plural(activeTasks.length, 'active task')}`} action={riskTasks.length > 0 ? <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] text-amber-100">{riskTasks.length} at risk</span> : null} />
          <div className="mt-4 space-y-1">
            {loading ? (
              <><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></>
            ) : pulseTasks.length === 0 ? (
              <EmptyState title="No task pulses yet" body="Agent work will surface here as soon as it is queued or in progress." />
            ) : pulseTasks.slice(0, 6).map(task => <TaskPulseItem key={task.id} task={task} />)}
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 lg:col-span-1">
          <SectionHeader title="Approval radar" eyebrow={`${plural(data.approvals.length, 'pending approval')}`} action={<Link href="/admin/social/queue" className="text-xs font-label uppercase tracking-wide" style={{ color: 'var(--color-accent-v2)' }}>Review →</Link>} />
          <div className="mt-4 space-y-1">
            {loading ? (
              <><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></>
            ) : data.approvals.length === 0 ? (
              <EmptyState title="Approval radar is clear" body="No posts or deliverables are waiting on review right now." />
            ) : data.approvals.slice(0, 6).map(approval => <ApprovalRadarItem key={approval.id} approval={approval} />)}
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 lg:col-span-1">
          <SectionHeader title="Today timeline" eyebrow="Latest movement" />
          <div className="relative mt-5 space-y-5 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-[var(--color-border)]">
            {loading ? (
              <><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></>
            ) : timeline.length === 0 ? (
              <div className="before:hidden"><EmptyState title="Timeline is quiet" body="Activity, task movement, and handoffs will appear here throughout the day." /></div>
            ) : timeline.map(item => <TimelineItem key={item.id} item={item} />)}
          </div>
        </section>
      </div>

      {loading && <p className="sr-only" aria-live="polite">Dashboard data is loading</p>}
      {loading && <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container)]/40 px-4 py-3 text-sm text-on-surface-variant">Loading command signal…</div>}
    </div>
  )
}
