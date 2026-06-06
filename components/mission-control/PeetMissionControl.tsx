'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

type BriefingCard = {
  id: string
  orgId?: string
  priority?: 'critical' | 'needs-peet' | 'client-risk' | 'review' | 'progress' | 'fyi' | string
  title: string
  summary?: string
  source?: { type?: string; id?: string; url?: string }
  actor?: { id?: string; name?: string | null; role?: string | null }
  context?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  occurredAt?: string
}

type AgentTask = {
  id: string
  title: string
  assigneeAgentId?: string | null
  agentStatus?: string | null
  columnId?: string | null
  priority?: string | null
  href?: string
  updatedAt?: string | null
  createdAt?: string | null
}


type LearningEvidence = { label: string; href?: string; type?: string }

type LearningDashboardMetric = {
  key: string
  label: string
  detail: string
  items: LearningEvidence[]
  icon: string
}

type MissionData = {
  items: BriefingCard[]
  tasks: AgentTask[]
  generatedAt?: string
}

const emptyData: MissionData = { items: [], tasks: [] }

function unwrapArray<T>(body: unknown): T[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  if (Array.isArray(record)) return record as T[]
  if (Array.isArray(record.data)) return record.data as T[]
  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>
    if (Array.isArray(data.items)) return data.items as T[]
    if (Array.isArray(data.cards)) return data.cards as T[]
  }
  if (Array.isArray(record.items)) return record.items as T[]
  if (Array.isArray(record.cards)) return record.cards as T[]
  return []
}

function unwrapGeneratedAt(body: unknown) {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
  return typeof data.generatedAt === 'string' ? data.generatedAt : undefined
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `Request failed: ${url}`)
  return body
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatTime(value?: string | null) {
  if (!value) return 'Today'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Today'
  return date.toLocaleString('en-ZA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sourceHref(item: BriefingCard) {
  const evidenceRows = item.metadata?.softwareBuildEvidence
  if (Array.isArray(evidenceRows)) {
    const linkedEvidence = evidenceRows.find((row) => {
      if (!row || typeof row !== 'object') return false
      return typeof (row as Record<string, unknown>).href === 'string' && Boolean((row as Record<string, unknown>).href)
    }) as Record<string, unknown> | undefined
    if (typeof linkedEvidence?.href === 'string') return linkedEvidence.href
  }
  return item.source?.url || '/admin/briefings'
}

function generatedAtStatus(value?: string | null, now = Date.now()) {
  if (!value) {
    return { stale: true, detail: 'No valid generatedAt timestamp was returned by the briefing feed.' }
  }
  const generated = new Date(value).getTime()
  if (Number.isNaN(generated)) {
    return { stale: true, detail: 'No valid generatedAt timestamp was returned by the briefing feed.' }
  }
  const ageMinutes = Math.floor((now - generated) / (60 * 1000))
  if (ageMinutes > 30) {
    return { stale: true, detail: `Generated ${formatTime(value)} (${ageMinutes} minutes old). Refresh or verify the source before using Mission Control for a release or promotion decision.` }
  }
  return { stale: false, detail: `Generated ${formatTime(value)}` }
}

function taskHref(task: AgentTask) {
  return task.href || '/admin/projects'
}

function includesAny(value: string, needles: string[]) {
  const lower = value.toLowerCase()
  return needles.some(needle => lower.includes(needle))
}

function decisionText(item: BriefingCard) {
  return asText(item.metadata?.decision) || item.summary || item.title
}

function revenueValue(item: BriefingCard) {
  return asText(item.metadata?.revenueValue) || asText(item.metadata?.value) || 'Revenue signal'
}

function nextAction(item: BriefingCard) {
  return asText(item.metadata?.nextAction) || item.summary || 'Review source evidence'
}

function isApproval(item: BriefingCard) {
  const haystack = `${item.priority ?? ''} ${item.source?.type ?? ''} ${item.title}`
  return includesAny(haystack, ['approval', 'gate', 'needs-peet'])
}

function isRevenue(item: BriefingCard) {
  const haystack = `${item.source?.type ?? ''} ${item.title} ${JSON.stringify(item.metadata ?? {})}`
  return includesAny(haystack, ['revenue', 'deal', 'proposal', 'prospect', 'crm'])
}

function isRisk(item: BriefingCard) {
  const haystack = `${item.priority ?? ''} ${item.title} ${item.summary ?? ''}`
  return includesAny(haystack, ['risk', 'blocked', 'blocker', 'closed', 'awaiting', 'gate']) || item.priority === 'critical' || item.priority === 'client-risk'
}

function isAgentOutput(item: BriefingCard) {
  return item.source?.type === 'agent-output' || includesAny(`${item.title} ${item.summary ?? ''}`, ['agent output', 'ready', 'completed'])
}

function isLearningItem(item: BriefingCard) {
  return item.source?.type === 'agent-learning-review' || Boolean(agentLearningReviewMetadata(item)?.reviewGate)
}

function normalizeEvidenceList(value: unknown): LearningEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): LearningEvidence[] => {
    if (typeof entry === 'string') {
      const label = entry.trim()
      return label ? [{ label }] : []
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const label = asText(record.label) || asText(record.title) || asText(record.summary) || asText(record.change) || asText(record.name)
    if (!label) return []
    return [{
      label,
      href: asText(record.href) || asText(record.url) || undefined,
      type: asText(record.type) || asText(record.category) || undefined,
    }]
  })
}

function agentLearningReviewMetadata(item: BriefingCard): Record<string, unknown> | null {
  const raw = item.metadata?.agentLearningReview
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function learningDashboardMetrics(items: BriefingCard[]): LearningDashboardMetric[] {
  const dashboardRows = items.flatMap((item) => {
    const metadata = agentLearningReviewMetadata(item)
    const dashboard = metadata?.dashboard
    return dashboard && typeof dashboard === 'object' && !Array.isArray(dashboard) ? [dashboard as Record<string, unknown>] : []
  })
  const collect = (field: string) => dashboardRows.flatMap(row => normalizeEvidenceList(row[field]))
  return [
    { key: 'skillsChanged', label: 'Skills added/updated', icon: 'school', detail: 'Skill changes proposed or completed with source links.', items: collect('skillsChanged') },
    { key: 'mistakesReduced', label: 'Recurring mistakes reduced', icon: 'psychology', detail: 'Repeated failure modes turned into guardrails.', items: collect('mistakesReduced') },
    { key: 'staleInstructionsFound', label: 'Stale instructions found', icon: 'manage_search', detail: 'Old SOPs or guidance flagged for review.', items: collect('staleInstructionsFound') },
    { key: 'blockedTasksPrevented', label: 'Blocked tasks prevented', icon: 'lock_open', detail: 'Blockers avoided by better routing, dependencies, or gates.', items: collect('blockedTasksPrevented') },
    { key: 'newSopsProposed', label: 'New SOPs proposed', icon: 'rule', detail: 'New runbooks or templates proposed for approval.', items: collect('newSopsProposed') },
    { key: 'knowledgeCaptured', label: 'Client/project knowledge captured', icon: 'menu_book', detail: 'Durable wiki, project, or client context added.', items: collect('knowledgeCaptured') },
  ]
}

function isFollowUp(task: AgentTask) {
  const status = task.agentStatus ?? task.columnId ?? ''
  return !['done', 'cancelled', 'completed'].includes(status)
}

function SectionTitle({ eyebrow, title, count }: { eyebrow: string; title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">{title}</h2>
      </div>
      {typeof count === 'number' ? <span className="rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">{count}</span> : null}
    </div>
  )
}

function EmptyCard({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-[var(--color-surface-container)]/35 p-4 text-sm text-on-surface-variant">{label}</div>
}

function BriefingList({ items, empty, renderMeta }: { items: BriefingCard[]; empty: string; renderMeta?: (item: BriefingCard) => string }) {
  if (items.length === 0) return <EmptyCard label={empty} />
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map(item => (
        <Link key={item.id} href={sourceHref(item)} className="group block rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-4 transition-colors hover:border-[var(--color-pib-accent)]/50">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 text-sm font-semibold text-on-surface group-hover:text-[var(--color-pib-accent-hover)]">{item.title}</p>
            <span className="shrink-0 rounded-full bg-[var(--color-surface-container)] px-2 py-1 text-[9px] font-label uppercase tracking-wide text-on-surface-variant">{item.source?.type ?? item.priority ?? 'card'}</span>
          </div>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-on-surface-variant">{item.summary || renderMeta?.(item) || 'Open source for evidence.'}</p>
          {renderMeta ? <p className="mt-3 text-xs font-medium text-[var(--color-pib-accent)]">{renderMeta(item)}</p> : null}
        </Link>
      ))}
    </div>
  )
}

function FollowUpList({ tasks }: { tasks: AgentTask[] }) {
  if (tasks.length === 0) return <EmptyCard label="No open follow-ups found. New tasks from Mission Control actions will appear here." />
  return (
    <div className="space-y-2">
      {tasks.slice(0, 6).map(task => (
        <Link key={task.id} href={taskHref(task)} className="group block rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-4 transition-colors hover:border-[var(--color-pib-accent)]/50">
          <p className="line-clamp-2 text-sm font-semibold text-on-surface group-hover:text-[var(--color-pib-accent-hover)]">{task.title}</p>
          <p className="mt-2 text-xs text-on-surface-variant">{task.assigneeAgentId ?? 'agent'} · {task.agentStatus ?? task.columnId ?? 'open'} · {task.priority ?? 'normal'}</p>
        </Link>
      ))}
    </div>
  )
}


function AgentLearningDashboard({ items, metrics }: { items: BriefingCard[]; metrics: LearningDashboardMetric[] }) {
  const totalEvidence = metrics.reduce((sum, metric) => sum + metric.items.length, 0)
  if (items.length === 0 && totalEvidence === 0) {
    return null
  }
  return (
    <Surface className="p-4 sm:p-5 lg:col-span-2" aria-label="Agent Learning dashboard">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">System learning</p>
          <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Agent Learning dashboard</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-on-surface-variant">
            Shows reviewable evidence that the PiB operating system is learning: no automatic skill/wiki rewrite, just source-backed improvements Peet can inspect.
          </p>
        </div>
        <Link href="/admin/briefings?source=agent-learning-review" className="pib-btn-secondary self-start">Open learning reviews</Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map(metric => {
          const preview = metric.items.slice(0, 2)
          return (
            <div key={metric.key} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{metric.label}</p>
                  <p className="mt-2 text-3xl font-headline font-bold leading-none text-on-surface">{metric.items.length}</p>
                </div>
                <span className="material-symbols-outlined text-[22px] text-[var(--color-pib-accent)]" aria-hidden>{metric.icon}</span>
              </div>
              <p className="mt-3 text-xs leading-5 text-on-surface-variant">{metric.detail}</p>
              {preview.length ? (
                <div className="mt-3 space-y-1">
                  {preview.map((item, index) => item.href ? (
                    <Link key={`${metric.key}-${index}`} href={item.href} className="block truncate text-xs font-medium text-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent-hover)]">{item.label}</Link>
                  ) : (
                    <p key={`${metric.key}-${index}`} className="truncate text-xs font-medium text-on-surface">{item.label}</p>
                  ))}
                </div>
              ) : <p className="mt-3 text-xs text-on-surface-variant">No evidence captured in this category yet.</p>}
            </div>
          )
        })}
      </div>
    </Surface>
  )
}

function KpiTile({ label, value, detail, icon }: { label: string; value: number | string; detail: string; icon: string }) {
  return (
    <Surface className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
          <p className="mt-3 text-3xl font-headline font-bold leading-none text-on-surface">{value}</p>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-accent)]/20 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
          <span className="material-symbols-outlined text-[21px]">{icon}</span>
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-on-surface-variant">{detail}</p>
    </Surface>
  )
}

export function PeetMissionControl() {
  const [data, setData] = useState<MissionData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const query = `orgId=${encodeURIComponent(PIB_PLATFORM_ORG_ID)}&limit=50`
        const [feedBody, taskBody] = await Promise.all([
          fetchJson(`/api/v1/briefings/feed?${query}`),
          fetchJson(`/api/v1/admin/agent-tasks?orgId=${encodeURIComponent(PIB_PLATFORM_ORG_ID)}&limit=30`),
        ])
        if (cancelled) return
        setData({ items: unwrapArray<BriefingCard>(feedBody), tasks: unwrapArray<AgentTask>(taskBody), generatedAt: unwrapGeneratedAt(feedBody) })
      } catch (err) {
        if (!cancelled) {
          setData(emptyData)
          setError(err instanceof Error ? err.message : 'Mission Control feeds unavailable')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const approvals = useMemo(() => data.items.filter(isApproval), [data.items])
  const revenue = useMemo(() => data.items.filter(isRevenue), [data.items])
  const risks = useMemo(() => data.items.filter(isRisk), [data.items])
  const outputs = useMemo(() => data.items.filter(isAgentOutput), [data.items])
  const learningItems = useMemo(() => data.items.filter(isLearningItem), [data.items])
  const learningMetrics = useMemo(() => learningDashboardMetrics(learningItems), [learningItems])
  const decisions = useMemo(() => data.items.filter(item => asText(item.metadata?.decision) || includesAny(item.title, ['approved', 'decision', 'choice'])), [data.items])
  const followUps = useMemo(() => data.tasks.filter(isFollowUp), [data.tasks])
  const generatedStatus = useMemo(() => generatedAtStatus(data.generatedAt), [data.generatedAt])

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <PageHeader
        eyebrow="Admin / Mission Control"
        title="Peet Mission Control"
        description="A top-level internal command page for today’s decisions, approvals, revenue cards, client risks, agent outputs, follow-ups, and KPI snapshot."
        meta={<span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-amber-100">Internal development only</span>}
        actions={(
          <>
            <Link href="/admin/briefings" className="pib-btn-secondary">Open Control Desk</Link>
            <Link href="/admin/projects" className="pib-btn-primary">Open Projects</Link>
          </>
        )}
      />

      {error ? <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">Some Mission Control feeds could not load: {error}.</div> : null}
      {!loading && generatedStatus.stale ? (
        <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100" role="status">
          <span className="font-semibold">Mission Control briefing data may be stale.</span> {generatedStatus.detail} Internal preview can continue, but do not use these cards for a release or promotion decision until the feed freshness is verified.
        </div>
      ) : null}

      <section aria-label="Mission Control KPI snapshot" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Live cards" value={data.items.length} icon="dashboard" detail={loading ? 'Loading briefing feed…' : generatedStatus.detail} />
        <KpiTile label="Approvals" value={approvals.length} icon="verified_user" detail="Human decisions and gated actions separated from execution." />
        <KpiTile label="Client risks" value={risks.length} icon="report" detail="Blocked, risk, and closed-gate cards that need attention." />
        <KpiTile label="Follow-ups" value={followUps.length} icon="task_alt" detail="Open project or agent tasks Peet can inspect next." />
        <KpiTile label="Agent learning" value={learningItems.length} icon="school" detail="Reviewable learning cards with skill, SOP, blocker, and knowledge evidence." />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AgentLearningDashboard items={learningItems} metrics={learningMetrics} />
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Decisions" title="Today’s decisions" count={decisions.length} />
          {decisions.length === 0 ? <EmptyCard label="No explicit decision cards found yet today." /> : (
            <div className="space-y-2">
              {decisions.slice(0, 4).map(item => (
                <Link key={item.id} href={sourceHref(item)} className="group block rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-4 transition-colors hover:border-[var(--color-pib-accent)]/50">
                  <p className="text-sm font-semibold text-on-surface group-hover:text-[var(--color-pib-accent-hover)]">{decisionText(item)}</p>
                  <p className="mt-2 text-xs text-on-surface-variant">{item.title} · {formatTime(item.occurredAt)}</p>
                  <p className="mt-3 text-xs font-medium text-[var(--color-pib-accent)]">Open source/evidence</p>
                </Link>
              ))}
            </div>
          )}
        </Surface>

        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Approvals" title="Approvals and gates" count={approvals.length} />
          <BriefingList items={approvals} empty="No open approval cards found in the briefing feed." />
        </Surface>

        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Pipeline" title="Revenue cards" count={revenue.length} />
          <BriefingList items={revenue} empty="No revenue cards found in the current briefing feed." renderMeta={(item) => `${revenueValue(item)} · ${nextAction(item)}`} />
        </Surface>

        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Risk" title="Client risks" count={risks.length} />
          <BriefingList items={risks} empty="No client risk cards found in the current briefing feed." />
        </Surface>

        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Agent work" title="Agent outputs" count={outputs.length} />
          <BriefingList items={outputs} empty="No agent-output cards found in the current briefing feed." renderMeta={(item) => `${item.actor?.name ?? item.actor?.id ?? 'Agent'} · ${nextAction(item)}`} />
        </Surface>

        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Next actions" title="Follow-ups" count={followUps.length} />
          <FollowUpList tasks={followUps} />
        </Surface>
      </div>

      {loading ? <p className="sr-only" aria-live="polite">Mission Control data is loading</p> : null}
    </div>
  )
}
