import { adminDb } from '@/lib/firebase/admin'
import { collectCrmBusinessInsightSignals } from './crm-business-signals'
import type { AgentEvolutionSignal, BusinessInsightSignal } from './review-evaluator'

type TaskDoc = {
  id: string
  data: () => Record<string, unknown>
  ref?: { path?: string }
}

export type LoopReviewSignalCollectionInput = {
  orgId: string
  projectId?: string | null
  limit?: number
  now?: Date
}

export type LoopReviewSignalCollection = {
  scanned: number
  sourceWindow: { from: string; to: string }
  agentSignals: AgentEvolutionSignal[]
  businessSignals: BusinessInsightSignal[]
  existingSuppressionKeys: string[]
}

const AGENT_STATUSES = new Set(['blocked', 'awaiting-input'])

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter((item): item is string => Boolean(item))
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function sourceWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
    to: now.toISOString(),
  }
}

function projectIdFromPath(path: string | undefined): string | null {
  if (!path) return null
  const match = path.match(/^projects\/([^/]+)\/tasks\/[^/]+/)
  return match?.[1] ?? null
}

function taskProjectId(doc: TaskDoc, data: Record<string, unknown>): string | null {
  return cleanString(data.projectId) ?? projectIdFromPath(doc.ref?.path)
}

function taskTitle(data: Record<string, unknown>, fallback: string): string {
  return cleanString(data.title) ?? fallback
}

function taskText(data: Record<string, unknown>): string {
  return [
    cleanString(data.title),
    cleanString(data.description),
    cleanString(data.agentOutput && typeof data.agentOutput === 'object' && !Array.isArray(data.agentOutput)
      ? (data.agentOutput as Record<string, unknown>).summary
      : null),
  ].filter(Boolean).join(' ').toLowerCase()
}

function taskHref(projectId: string | null, taskId: string): string {
  return projectId ? `/admin/projects/${projectId}?task=${taskId}` : `/admin/agent/board?task=${taskId}`
}

function riskScore(data: Record<string, unknown>): number {
  const riskLevel = cleanString(data.riskLevel)
  const priority = cleanString(data.priority)
  if (riskLevel === 'critical') return 90
  if (riskLevel === 'high') return 78
  if (priority === 'urgent') return 82
  if (priority === 'high') return 68
  return 45
}

function isHighRiskTask(data: Record<string, unknown>): boolean {
  const riskLevel = cleanString(data.riskLevel)
  const priority = cleanString(data.priority)
  return riskLevel === 'critical' || riskLevel === 'high' || priority === 'urgent'
}

function agentSignalForTask(doc: TaskDoc, data: Record<string, unknown>, projectId: string | null): AgentEvolutionSignal | null {
  const assigneeAgentId = cleanString(data.assigneeAgentId)
  const status = cleanString(data.agentStatus)
  const reviewStatus = cleanString(data.reviewStatus)
  if (!assigneeAgentId) return null
  if (!AGENT_STATUSES.has(status ?? '') && reviewStatus !== 'changes-requested') return null

  const text = taskText(data)
  const category: AgentEvolutionSignal['category'] = reviewStatus === 'changes-requested'
    ? 'review-rework'
    : /missing|source|context|spec|brief|requirement/.test(text)
      ? 'missing-context'
      : 'repeat-blocker'
  const title = taskTitle(data, doc.id)
  const updatedAt = cleanString(data.updatedAt)

  return {
    id: `task-${doc.id}`,
    category,
    targetSurface: `agent:${assigneeAgentId}`,
    title,
    summary: `Task ${doc.id} is ${reviewStatus === 'changes-requested' ? 'back from review' : status}.`,
    severity: Math.max(70, riskScore(data)),
    confidence: category === 'missing-context' ? 82 : 72,
    easeOfFix: category === 'missing-context' ? 74 : 62,
    risk: category === 'review-rework' ? 35 : 25,
    source: {
      type: 'task',
      id: doc.id,
      href: taskHref(projectId, doc.id),
      label: title,
    },
    occurredAt: updatedAt ?? undefined,
  }
}

function businessSignalForTask(
  doc: TaskDoc,
  data: Record<string, unknown>,
  projectId: string | null,
  existingSuppressionKeys: Set<string>,
): BusinessInsightSignal | null {
  const orgId = cleanString(data.orgId)
  const status = cleanString(data.agentStatus)
  if (!orgId || !AGENT_STATUSES.has(status ?? '') || !isHighRiskTask(data)) return null

  const title = taskTitle(data, doc.id)
  const suppressionKey = `project-risk:${orgId}:${doc.id}`
  const labels = cleanStringArray(data.labels)
  const stateLabel = status === 'awaiting-input' ? 'awaiting input' : 'blocked'

  return {
    id: `task-risk-${doc.id}`,
    lane: 'project',
    insightKind: 'risk',
    summary: `High-risk work is ${stateLabel}: ${title}`,
    impactEstimate: 'Potential client delivery or revenue risk',
    metric: 'high_risk_blocked_task',
    value: 1,
    impact: Math.max(80, riskScore(data)),
    urgency: cleanString(data.priority) === 'urgent' ? 88 : 76,
    confidence: labels.includes('client-risk') || labels.includes('revenue') ? 76 : 68,
    actionability: 76,
    risk: 30,
    ownerAgentId: cleanString(data.assigneeAgentId) ?? 'pip',
    ownerRole: 'project-owner',
    nextAction: 'Review the blocked work, assign a clear owner, and create the smallest approved unblock action.',
    suppressionKey,
    sourceLinks: [{
      type: 'task',
      id: doc.id,
      href: taskHref(projectId, doc.id),
      label: title,
    }],
    evidence: [
      { label: 'Task state', value: stateLabel },
      { label: 'Risk level', value: cleanString(data.riskLevel) ?? cleanString(data.priority) ?? 'high' },
    ],
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !existingSuppressionKeys.has(suppressionKey),
  }
}

function suppressionKeyFromTask(data: Record<string, unknown>): string | null {
  const metadata = data.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const insight = (metadata as Record<string, unknown>).businessInsightReview
  if (!insight || typeof insight !== 'object' || Array.isArray(insight)) return null
  return cleanString((insight as Record<string, unknown>).suppressionKey)
}

export async function collectLoopReviewSignals(input: LoopReviewSignalCollectionInput): Promise<LoopReviewSignalCollection> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const window = sourceWindow(now)
  const snap = await adminDb.collectionGroup('tasks')
    .where('orgId', '==', input.orgId)
    .limit(limit)
    .get() as { docs: TaskDoc[] }

  const docs = snap.docs.filter((doc) => {
    const data = doc.data()
    const projectId = taskProjectId(doc, data)
    return !input.projectId || projectId === input.projectId
  })
  const existingSuppressionKeys = new Set<string>()
  for (const doc of docs) {
    const key = suppressionKeyFromTask(doc.data())
    if (key) existingSuppressionKeys.add(key)
  }

  const agentSignals: AgentEvolutionSignal[] = []
  const businessSignals: BusinessInsightSignal[] = []
  for (const doc of docs) {
    const data = doc.data()
    if (data.deleted === true) continue
    const projectId = taskProjectId(doc, data)
    const agentSignal = agentSignalForTask(doc, data, projectId)
    if (agentSignal) agentSignals.push(agentSignal)
    const businessSignal = businessSignalForTask(doc, data, projectId, existingSuppressionKeys)
    if (businessSignal) businessSignals.push(businessSignal)
  }
  const crmCollection = await collectCrmBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  businessSignals.push(...crmCollection.signals)

  return {
    scanned: snap.docs.length + crmCollection.contactsScanned + crmCollection.dealsScanned,
    sourceWindow: window,
    agentSignals,
    businessSignals,
    existingSuppressionKeys: [...existingSuppressionKeys].sort(),
  }
}
