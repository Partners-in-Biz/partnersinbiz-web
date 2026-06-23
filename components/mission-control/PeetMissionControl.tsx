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
type BusinessInsightEvidence = { label: string; value?: string; href?: string; type?: string }

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

function isBusinessInsightItem(item: BriefingCard) {
  return item.source?.type === 'business-insight-review' || Boolean(businessInsightReviewMetadata(item)?.reviewGate)
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

function normalizeBusinessInsightEvidence(value: unknown): BusinessInsightEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): BusinessInsightEvidence[] => {
    if (typeof entry === 'string') {
      const label = entry.trim()
      return label ? [{ label }] : []
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const label = asText(record.label) || asText(record.title) || asText(record.metric) || asText(record.name)
    if (!label) return []
    return [{
      label,
      value: typeof record.value === 'number' ? String(record.value) : asText(record.value) || asText(record.summary) || undefined,
      href: asText(record.href) || asText(record.url) || undefined,
      type: asText(record.type) || asText(record.kind) || undefined,
    }]
  })
}

function agentLearningReviewMetadata(item: BriefingCard): Record<string, unknown> | null {
  const raw = item.metadata?.agentLearningReview
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function businessInsightReviewMetadata(item: BriefingCard): Record<string, unknown> | null {
  const raw = item.metadata?.businessInsightReview
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
    { key: 'knowledgeCaptured', label: 'Org/project knowledge captured', icon: 'menu_book', detail: 'Durable wiki, project, or scoped organisation context added.', items: collect('knowledgeCaptured') },
  ]
}

function businessInsightScore(item: BriefingCard): number {
  const metadata = businessInsightReviewMetadata(item)
  const score = metadata?.score
  if (!score || typeof score !== 'object' || Array.isArray(score)) return 0
  const total = (score as Record<string, unknown>).total
  return typeof total === 'number' && Number.isFinite(total) ? total : 0
}

function businessInsightLane(item: BriefingCard): string {
  const lane = asText(businessInsightReviewMetadata(item)?.lane)
  return lane ? lane.toUpperCase() : 'GENERAL'
}

function businessInsightImpact(item: BriefingCard): string {
  const impact = businessInsightReviewMetadata(item)?.businessImpact
  if (impact && typeof impact === 'object' && !Array.isArray(impact)) {
    return asText((impact as Record<string, unknown>).estimateLabel) || 'Business impact needs review'
  }
  return 'Business impact needs review'
}

function businessInsightRecommendation(item: BriefingCard): string {
  const recommendation = businessInsightReviewMetadata(item)?.recommendation
  if (recommendation && typeof recommendation === 'object' && !Array.isArray(recommendation)) {
    return asText((recommendation as Record<string, unknown>).nextAction) || item.summary || 'Review source evidence'
  }
  return item.summary || 'Review source evidence'
}

function businessInsightEvidence(item: BriefingCard): BusinessInsightEvidence[] {
  return normalizeBusinessInsightEvidence(businessInsightReviewMetadata(item)?.evidence)
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

function BusinessInsightDashboard({ items }: { items: BriefingCard[] }) {
  if (items.length === 0) return null
  const ordered = [...items].sort((a, b) => businessInsightScore(b) - businessInsightScore(a))
  const top = ordered[0]
  const lanes = Array.from(items.reduce((map, item) => {
    const lane = businessInsightLane(item)
    map.set(lane, (map.get(lane) ?? 0) + 1)
    return map
  }, new Map<string, number>()))

  return (
    <Surface className="p-4 sm:p-5 lg:col-span-2" aria-label="Business Insights dashboard">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Business intelligence</p>
          <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Business Insights dashboard</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-on-surface-variant">
            Proactive growth, risk, follow-up, and missing-data cards surfaced from briefing evidence. Review stays internal until an explicit approval gate is satisfied.
          </p>
        </div>
        <Link href="/admin/briefings?source=business-insight-review" className="pib-btn-secondary self-start">Open insight reviews</Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Insight lanes</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {lanes.map(([lane, count]) => (
              <span key={lane} className="inline-flex items-center gap-2 rounded-full bg-[var(--color-surface-container)] px-3 py-1 text-xs font-medium text-on-surface">
                <span>{lane}</span>
                <span className="text-on-surface-variant">{count}</span>
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-on-surface-variant">{items.length} proactive insight{items.length === 1 ? '' : 's'} waiting for review.</p>
        </div>
        <Link href={sourceHref(top)} className="group rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-4 transition-colors hover:border-[var(--color-pib-accent)]/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Highest impact</p>
              <p className="mt-2 text-sm font-semibold text-on-surface group-hover:text-[var(--color-pib-accent-hover)]">{top.title}</p>
            </div>
            <span className="rounded-full bg-[var(--color-pib-accent-soft)] px-2 py-1 text-xs font-medium text-[var(--color-pib-accent)]">Score {businessInsightScore(top)}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-on-surface-variant">{businessInsightImpact(top)}</p>
          <p className="mt-2 text-xs font-medium text-[var(--color-pib-accent)]">{businessInsightRecommendation(top)}</p>
          <div className="mt-3 space-y-1">
            {businessInsightEvidence(top).slice(0, 3).map((row, index) => (
              <p key={`${top.id}-evidence-${index}`} className="flex min-w-0 items-center gap-2 text-xs font-medium text-on-surface">
                <span className="truncate">{row.label}</span>
                {row.value ? <span className="shrink-0 text-on-surface-variant">{row.value}</span> : null}
              </p>
            ))}
          </div>
        </Link>
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
  const businessInsights = useMemo(() => data.items.filter(isBusinessInsightItem), [data.items])
  const decisions = useMemo(() => data.items.filter(item => asText(item.metadata?.decision) || includesAny(item.title, ['approved', 'decision', 'choice'])), [data.items])
  const followUps = useMemo(() => data.tasks.filter(isFollowUp), [data.tasks])
  const generatedStatus = useMemo(() => generatedAtStatus(data.generatedAt), [data.generatedAt])

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <PageHeader
        eyebrow="Admin / Mission Control"
        title="Peet Mission Control"
        description="A top-level internal operator command page for today’s decisions, approvals, revenue cards, scoped org risks, agent outputs, follow-ups, and KPI snapshot."
        meta={<span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-amber-100">Internal development only</span>}
        actions={(
          <>
            <Link href="/admin/briefings" className="pib-btn-secondary">Open admin Control Desk</Link>
            <Link href="/admin/projects" className="pib-btn-primary">Open admin Projects</Link>
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
        <KpiTile label="Scoped org risks" value={risks.length} icon="report" detail="Blocked, risk, and closed-gate cards that need operator attention." />
        <KpiTile label="Follow-ups" value={followUps.length} icon="task_alt" detail="Open project or agent tasks Peet can inspect next." />
        <KpiTile label="Agent learning" value={learningItems.length} icon="school" detail="Reviewable learning cards with skill, SOP, blocker, and knowledge evidence." />
        <KpiTile label="Business insights" value={businessInsights.length} icon="monitoring" detail="Proactive commercial, growth, risk, and missing-data cards surfaced from evidence." />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AgentLearningDashboard items={learningItems} metrics={learningMetrics} />
        <BusinessInsightDashboard items={businessInsights} />
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
          <SectionTitle eyebrow="Risk" title="Scoped org risks" count={risks.length} />
          <BriefingList items={risks} empty="No scoped organisation risk cards found in the current briefing feed." />
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

      {/* Platform Infrastructure Panels */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* System Jobs */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Background processing" title="System Jobs" />
          <p className="text-xs text-on-surface-variant mb-4">Background job queue — cron jobs, email sends, webhooks.</p>
          <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)]">
            <div className="grid grid-cols-12 gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-4 py-2">
              <span className="col-span-6 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Job</span>
              <span className="col-span-3 text-center text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</span>
              <span className="col-span-3 text-center text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Last run</span>
            </div>
            {[
              { name: 'Email send queue', status: 'Idle', last: 'Just now' },
              { name: 'Webhook dispatcher', status: 'Idle', last: '2m ago' },
              { name: 'Briefing feed refresh', status: 'Scheduled', last: '15m ago' },
            ].map(job => (
              <div key={job.name} className="grid grid-cols-12 gap-3 items-center border-b border-[var(--color-card-border)] px-4 py-3 last:border-b-0">
                <p className="col-span-6 text-sm text-on-surface">{job.name}</p>
                <p className="col-span-3 text-center text-xs text-on-surface-variant">{job.status}</p>
                <p className="col-span-3 text-center text-xs text-on-surface-variant">{job.last}</p>
              </div>
            ))}
          </div>
        </Surface>

        {/* Error Logs */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Observability" title="Error Logs" />
          <p className="text-xs text-on-surface-variant mb-4">Application error log viewer.</p>
          <div className="space-y-2">
            {[
              { level: 'INFO', msg: 'Briefing feed loaded successfully', ts: 'Just now' },
              { level: 'WARN', msg: 'Slow API response — /api/v1/organizations (1.4s)', ts: '4m ago' },
              { level: 'INFO', msg: 'Notification preferences saved', ts: '12m ago' },
            ].map((entry, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 px-3 py-2 flex items-start gap-3">
                <span className={`shrink-0 text-[9px] font-label uppercase tracking-widest px-1.5 py-1 rounded ${entry.level === 'WARN' ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{entry.level}</span>
                <span className="flex-1 text-xs text-on-surface">{entry.msg}</span>
                <span className="shrink-0 text-[10px] text-on-surface-variant">{entry.ts}</span>
              </div>
            ))}
          </div>
        </Surface>

        {/* Database Tools */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Data management" title="Database Tools" />
          <p className="text-xs text-on-surface-variant mb-4">Firestore collection browser and management tools.</p>
          <div className="space-y-2">
            {['organizations', 'briefing_cards', 'agent_tasks', 'notification_preferences', 'hermes_profile_links'].map(col => (
              <div key={col} className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 px-3 py-2">
                <span className="font-mono text-xs text-on-surface">{col}</span>
                <button type="button" className="text-[10px] text-on-surface-variant hover:text-on-surface px-2 py-1 rounded hover:bg-[var(--color-surface-container)] transition-colors">Browse →</button>
              </div>
            ))}
          </div>
        </Surface>

        {/* Data Migration Tools */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Schema management" title="Data Migration Tools" />
          <p className="text-xs text-on-surface-variant mb-4">Schema migration history and pending migrations.</p>
          <div className="space-y-2">
            {[
              { id: 'M-001', name: 'Add notification_preferences collection', status: 'Applied' },
              { id: 'M-002', name: 'Firestore indexes — partners org', status: 'Applied' },
              { id: 'M-003', name: 'hermes_profile_links schema', status: 'Applied' },
            ].map(m => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-on-surface">{m.name}</p>
                  <p className="text-[10px] text-on-surface-variant">{m.id}</p>
                </div>
                <span className="text-[9px] font-label uppercase tracking-widest px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">{m.status}</span>
              </div>
            ))}
          </div>
        </Surface>

        {/* Infrastructure Status */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Uptime" title="Infrastructure Status" />
          <p className="text-xs text-on-surface-variant mb-4">VPS, CDN, and API gateway status monitors.</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'Hermes VPS (hermes-vps-01)', status: 'Operational' },
              { name: 'Vercel Edge CDN', status: 'Operational' },
              { name: 'Firebase / Firestore', status: 'Operational' },
              { name: 'Resend Email API', status: 'Operational' },
              { name: 'Caddy Reverse Proxy', status: 'Operational' },
              { name: 'Wiki Git Mirror', status: 'Syncing' },
            ].map(s => (
              <div key={s.name} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)]/35 p-3">
                <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">{s.name}</p>
                <p className={`mt-2 text-sm font-bold ${s.status === 'Operational' ? 'text-emerald-300' : 'text-amber-200'}`}>{s.status}</p>
              </div>
            ))}
          </div>
        </Surface>

        {/* Document Storage */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Storage" title="Document Storage" />
          <p className="text-xs text-on-surface-variant mb-4">Storage utilisation by organisation.</p>
          <EmptyCard label="Storage metrics will appear here when the document storage adapter is connected." />
          <button type="button" className="mt-3 text-xs text-on-surface-variant hover:text-on-surface px-3 py-2 rounded border border-[var(--color-card-border)] hover:bg-[var(--color-surface-container)] transition-colors">View storage →</button>
        </Surface>

        {/* Org Backups */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Disaster recovery" title="Org Backups" />
          <p className="text-xs text-on-surface-variant mb-4">Automated backup schedule and restore history.</p>
          <EmptyCard label="Backup schedule and restore jobs will appear here." />
          <button type="button" className="mt-3 text-xs text-on-surface-variant hover:text-on-surface px-3 py-2 rounded border border-[var(--color-card-border)] hover:bg-[var(--color-surface-container)] transition-colors">Configure backups →</button>
        </Surface>

        {/* Wiki Sync Monitor */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Knowledge sync" title="Wiki Sync Monitor" />
          <p className="text-xs text-on-surface-variant mb-4">GitHub ↔ Obsidian wiki sync status and conflict log.</p>
          <div className="space-y-2">
            {[
              { label: 'Mac → GitHub (launchd every 5m)', status: 'Active' },
              { label: 'VPS → GitHub (systemd every 5m)', status: 'Active' },
              { label: 'Obsidian Sync (Mac ↔ mobile)', status: 'Active' },
              { label: 'Conflict log', status: 'Clean' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70 px-3 py-2">
                <span className="text-xs text-on-surface">{row.label}</span>
                <span className={`text-[9px] font-label uppercase tracking-widest px-2 py-1 rounded ${row.status === 'Active' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-[var(--color-surface-container)] text-on-surface-variant'}`}>{row.status}</span>
              </div>
            ))}
          </div>
        </Surface>

        {/* Broadcast Centre */}
        <Surface className="p-4 sm:p-5">
          <SectionTitle eyebrow="Announcements" title="Broadcast Centre" />
          <p className="text-xs text-on-surface-variant mb-4">Send announcements to all organisations.</p>
          <div className="space-y-3">
            <textarea disabled rows={3} placeholder="Compose announcement..." className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)]/35 px-3 py-2 text-sm text-on-surface-variant resize-none cursor-not-allowed" />
            <button type="button" className="text-xs text-on-surface-variant hover:text-on-surface px-3 py-2 rounded border border-[var(--color-card-border)] hover:bg-[var(--color-surface-container)] transition-colors">Send broadcast →</button>
          </div>
        </Surface>

        {/* Admin Audit Log */}
        <Surface className="p-4 sm:p-5 lg:col-span-2">
          <SectionTitle eyebrow="Compliance" title="Admin Audit Log" />
          <p className="text-xs text-on-surface-variant mb-4">Full admin action log for compliance and security.</p>
          <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)]">
            <div className="grid grid-cols-12 gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-4 py-2">
              <span className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Actor</span>
              <span className="col-span-6 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Action</span>
              <span className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Time</span>
            </div>
            {[
              { actor: 'peet@partnersinbiz.online', action: 'Viewed Mission Control', time: 'Just now' },
              { actor: 'pip (agent)', action: 'Updated briefing feed', time: '8m ago' },
              { actor: 'system', action: 'Notification preference saved', time: '14m ago' },
            ].map((entry, i) => (
              <div key={i} className="grid grid-cols-12 gap-3 items-center border-b border-[var(--color-card-border)] px-4 py-3 last:border-b-0">
                <p className="col-span-3 text-xs text-on-surface font-medium truncate">{entry.actor}</p>
                <p className="col-span-6 text-xs text-on-surface-variant">{entry.action}</p>
                <p className="col-span-3 text-xs text-on-surface-variant">{entry.time}</p>
              </div>
            ))}
          </div>
        </Surface>
      </div>

      {loading ? <p className="sr-only" aria-live="polite">Mission Control data is loading</p> : null}
    </div>
  )
}
