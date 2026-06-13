import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type SeoDoc = {
  id: string
  data: () => Record<string, unknown>
}

type SourceLink = {
  type: string
  id?: string
  href?: string
  label: string
}

type EvidenceItem = {
  label: string
  value?: string | number
  href?: string
}

export type SeoBusinessMetric = 'seo_blocked_tasks' | 'seo_high_severity_signals'

export type SeoBusinessMetricSnapshot = {
  metric: SeoBusinessMetric
  value: number
  capturedAt: string
  source: 'seo-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectSeoBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectSeoBusinessInsightSignalsResult = {
  tasksScanned: number
  sprintsScanned: number
  metrics: SeoBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshSeoBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type SeoTaskRow = Record<string, unknown> & { id: string }
type SeoSprintRow = Record<string, unknown> & { id: string }

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function taskLabel(task: SeoTaskRow): string {
  return cleanString(task.title) ?? cleanString(task.focus) ?? task.id
}

function sprintLabel(sprint: SeoSprintRow): string {
  return cleanString(sprint.siteName) ?? cleanString(sprint.siteUrl) ?? sprint.id
}

function isBlockedTask(task: SeoTaskRow): boolean {
  return task.deleted !== true && cleanString(task.status) === 'blocked'
}

function isActiveSprint(sprint: SeoSprintRow): boolean {
  const status = cleanString(sprint.status)
  return sprint.deleted !== true && status !== 'archived' && status !== 'paused'
}

function healthSignals(sprint: SeoSprintRow): Record<string, unknown>[] {
  const health = sprint.health
  if (!health || typeof health !== 'object' || Array.isArray(health)) return []
  const signals = (health as Record<string, unknown>).signals
  return Array.isArray(signals)
    ? signals.filter((signal): signal is Record<string, unknown> => Boolean(signal && typeof signal === 'object' && !Array.isArray(signal)))
    : []
}

function highSeveritySignals(sprint: SeoSprintRow): Record<string, unknown>[] {
  if (!isActiveSprint(sprint)) return []
  return healthSignals(sprint).filter((signal) => cleanString(signal.severity) === 'high')
}

function sourceLinkForTask(task: SeoTaskRow): SourceLink {
  const sprintId = cleanString(task.sprintId)
  return {
    type: 'seo-task',
    id: task.id,
    href: sprintId
      ? `/portal/seo/sprints/${encodeURIComponent(sprintId)}/tasks?task=${encodeURIComponent(task.id)}`
      : `/portal/seo?task=${encodeURIComponent(task.id)}`,
    label: taskLabel(task),
  }
}

function sourceLinkForSprint(sprint: SeoSprintRow): SourceLink {
  return {
    type: 'seo-sprint',
    id: sprint.id,
    href: `/portal/seo/sprints/${encodeURIComponent(sprint.id)}/health`,
    label: sprintLabel(sprint),
  }
}

async function listOrgRows(collectionName: 'seo_tasks' | 'seo_sprints', orgId: string, limit: number): Promise<Array<SeoTaskRow | SeoSprintRow>> {
  const snap = await adminDb.collection(collectionName)
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: SeoDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as SeoTaskRow | SeoSprintRow)
    .filter((row) => row.deleted !== true)
}

function blockedTasksMetric(tasks: SeoTaskRow[], now: Date): SeoBusinessMetricSnapshot {
  const candidates = tasks.filter(isBlockedTask)
  return {
    metric: 'seo_blocked_tasks',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'seo-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForTask),
    evidence: [
      { label: 'Blocked SEO tasks', value: candidates.length },
      ...candidates.slice(0, 3).map((task) => ({
        label: taskLabel(task),
        value: cleanString(task.blockerReason) ?? 'blocked',
      })),
    ],
  }
}

function highSeveritySignalsMetric(sprints: SeoSprintRow[], now: Date): SeoBusinessMetricSnapshot {
  const sprintSignals = sprints
    .map((sprint) => ({ sprint, signals: highSeveritySignals(sprint) }))
    .filter((item) => item.signals.length > 0)
  const count = sprintSignals.reduce((sum, item) => sum + item.signals.length, 0)
  const signalTypes = Array.from(new Set(sprintSignals.flatMap((item) => item.signals.map((signal) => cleanString(signal.type) ?? 'seo-signal')))).slice(0, 5)
  return {
    metric: 'seo_high_severity_signals',
    value: count,
    capturedAt: now.toISOString(),
    source: 'seo-business-signals',
    sourceLinks: sprintSignals.slice(0, 5).map((item) => sourceLinkForSprint(item.sprint)),
    evidence: [
      { label: 'High-severity SEO health signals', value: count },
      ...(signalTypes.length ? [{ label: 'Signal types', value: signalTypes.join(', ') }] : []),
    ],
  }
}

function blockedTasksSignal(input: {
  orgId: string
  metric: SeoBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `seo:blocked-tasks:${input.orgId}`
  const plural = input.metric.value === 1 ? 'task is' : 'tasks are'
  return {
    id: `seo-blocked-tasks-${input.orgId}`,
    lane: 'seo',
    insightKind: 'risk',
    summary: `${input.metric.value} SEO ${plural} blocked`,
    impactEstimate: 'Organic growth delivery risk from blocked SEO execution',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(92, 72 + input.metric.value * 6),
    urgency: 84,
    confidence: 84,
    actionability: 82,
    risk: 22,
    ownerAgentId: 'seo',
    ownerRole: 'seo',
    nextAction: 'Review blocked SEO tasks, resolve missing context or ownership, and create internal unblock work before changing public content.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

function highSeveritySignalsSignal(input: {
  orgId: string
  metric: SeoBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `seo:high-severity-signals:${input.orgId}`
  const plural = input.metric.value === 1 ? 'signal needs' : 'signals need'
  return {
    id: `seo-high-severity-signals-${input.orgId}`,
    lane: 'seo',
    insightKind: 'performance-drop',
    summary: `${input.metric.value} high-severity SEO health ${plural} review`,
    impactEstimate: 'Organic search performance risk from high-severity SEO health signals',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(94, 74 + input.metric.value * 6),
    urgency: 86,
    confidence: 78,
    actionability: 76,
    risk: 24,
    ownerAgentId: 'seo',
    ownerRole: 'seo',
    nextAction: 'Review high-severity SEO health signals and create internal diagnosis tasks before applying public content or technical changes.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

export async function collectSeoBusinessInsightSignals(
  input: CollectSeoBusinessInsightSignalsInput,
): Promise<CollectSeoBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const [tasks, sprints] = await Promise.all([
    listOrgRows('seo_tasks', input.orgId, limit) as Promise<SeoTaskRow[]>,
    listOrgRows('seo_sprints', input.orgId, limit) as Promise<SeoSprintRow[]>,
  ])
  const metrics = [
    blockedTasksMetric(tasks, now),
    highSeveritySignalsMetric(sprints, now),
  ]
  const signals = [
    blockedTasksSignal({ orgId: input.orgId, metric: metrics[0], existingSuppressionKeys }),
    highSeveritySignalsSignal({ orgId: input.orgId, metric: metrics[1], existingSuppressionKeys }),
  ].filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    tasksScanned: tasks.length,
    sprintsScanned: sprints.length,
    metrics,
    signals,
  }
}

export async function refreshSeoBusinessInsightMetric(
  input: RefreshSeoBusinessInsightMetricInput,
): Promise<SeoBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (metric !== 'seo_blocked_tasks' && metric !== 'seo_high_severity_signals') return null

  const collection = await collectSeoBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
