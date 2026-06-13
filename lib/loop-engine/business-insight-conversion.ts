import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { isValidAgentId } from '@/lib/agents/types'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'

type ConversionOk = {
  ok: true
  created: boolean
  projectId: string
  reviewTaskId: string
  actionTaskId: string
}

type ConversionError = {
  ok: false
  status: number
  error: string
}

export type ConvertBusinessInsightInput = {
  projectId: string
  reviewTaskId: string
  actorId: string
  actorType?: 'user' | 'agent' | 'system'
  now?: Date
}

type BusinessInsightData = {
  type?: unknown
  lane?: unknown
  insightKind?: unknown
  summary?: unknown
  businessImpact?: unknown
  recommendation?: unknown
  suppressionKey?: unknown
  score?: unknown
  sourceLinks?: unknown
  evidence?: unknown
  conversion?: unknown
}

const CONVERSION_CONSTRAINTS = [
  'internal follow-up only',
  'no external send, public publish, paid spend, finance, secret/config, production deploy, or destructive data change without separate approval',
]

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isConversionError(value: ConversionError | Record<string, unknown>): value is ConversionError {
  return (value as ConversionError).ok === false
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as T
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)] as const)
      .filter(([, item]) => item !== undefined)
    return Object.fromEntries(entries) as T
  }
  return value
}

function actionTaskId(projectId: string, reviewTaskId: string, suppressionKey: string | null): string {
  const hash = createHash('sha256')
    .update(`${projectId}\0${reviewTaskId}\0${suppressionKey ?? ''}`)
    .digest('hex')
    .slice(0, 20)
  return `business-insight-action-${hash}`
}

function insightData(task: Record<string, unknown>): BusinessInsightData | null {
  const metadata = task.metadata
  if (!isRecord(metadata)) return null
  const insight = metadata.businessInsightReview
  if (!isRecord(insight)) return null
  return insight as BusinessInsightData
}

function recommendation(data: BusinessInsightData): Record<string, unknown> {
  return isRecord(data.recommendation) ? data.recommendation : {}
}

function businessImpact(data: BusinessInsightData): Record<string, unknown> {
  return isRecord(data.businessImpact) ? data.businessImpact : {}
}

function existingConversionActionTaskId(data: BusinessInsightData): string | null {
  if (!isRecord(data.conversion)) return null
  return cleanString(data.conversion.actionTaskId)
}

function expectedDirection(metric: string | null): 'increase' | 'decrease' | 'complete' {
  if (!metric) return 'complete'
  if (/unowned|blocked|stale|missing|risk|gap|overdue|failed/i.test(metric)) return 'decrease'
  return 'increase'
}

function reviewAfterAt(now: Date): string {
  return new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString()
}

function labelsForInsight(data: BusinessInsightData): string[] {
  return Array.from(new Set([
    'business-insight-action',
    'business-insight-review',
    cleanString(data.lane),
    cleanString(data.insightKind),
    'internal-only',
  ].filter((label): label is string => Boolean(label))))
}

function assigneeForInsight(data: BusinessInsightData): string {
  const ownerAgentId = cleanString(recommendation(data).ownerAgentId)
  return ownerAgentId && isValidAgentId(ownerAgentId) ? ownerAgentId : 'pip'
}

function buildActionTaskPayload(args: {
  projectId: string
  reviewTaskId: string
  task: Record<string, unknown>
  insight: BusinessInsightData
  actionTaskId: string
  actorId: string
  actorType: 'user' | 'agent' | 'system'
  now: Date
}): Record<string, unknown> | ConversionError {
  const rec = recommendation(args.insight)
  const impact = businessImpact(args.insight)
  const summary = cleanString(args.insight.summary) ?? cleanString(args.task.title) ?? 'Business insight needs follow-up'
  const nextAction = cleanString(rec.nextAction)
  if (!nextAction) return { ok: false, status: 400, error: 'Business insight review is missing a recommended next action' }

  const metric = cleanString(impact.metric)
  const baselineValue = cleanNumber(impact.value)
  const reviewAt = reviewAfterAt(args.now)
  const outcomeMeasurement = {
    metric,
    baselineValue,
    baselineCapturedAt: args.now.toISOString(),
    expectedDirection: expectedDirection(metric),
    reviewAfterAt: reviewAt,
    measurementStatus: 'pending',
  }

  const built = buildProjectTaskCreateData({
    orgId: cleanString(args.task.orgId),
    title: `Act on insight: ${summary}`,
    description: `${cleanString(impact.estimateLabel) ?? 'Business insight needs follow-up'}. ${nextAction}`,
    columnId: 'todo',
    priority: 'high',
    labels: labelsForInsight(args.insight),
    internalOnly: true,
    assigneeAgentId: assigneeForInsight(args.insight),
    agentStatus: 'pending',
    reviewerAgentId: 'nora',
    dependsOn: [args.reviewTaskId],
    agentInput: {
      spec: nextAction,
      context: {
        sourceReviewTaskId: args.reviewTaskId,
        sourceActionTaskId: args.actionTaskId,
        businessInsightReview: args.insight,
        outcomeMeasurement,
      },
      constraints: CONVERSION_CONSTRAINTS,
    },
  }, args.projectId, cleanString(args.task.orgId) ?? undefined)

  if (!built.ok) return { ok: false, status: built.status ?? 400, error: built.error }

  return stripUndefined({
    ...built.value,
    reporterId: args.actorId,
    createdBy: args.actorId,
    createdByType: args.actorType,
    updatedBy: args.actorId,
    updatedByType: args.actorType,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    metadata: {
      businessInsightAction: {
        schemaVersion: 1,
        sourceReviewTaskId: args.reviewTaskId,
        suppressionKey: cleanString(args.insight.suppressionKey),
        lane: cleanString(args.insight.lane),
        insightKind: cleanString(args.insight.insightKind),
        sourceLinks: Array.isArray(args.insight.sourceLinks) ? args.insight.sourceLinks : [],
        evidence: Array.isArray(args.insight.evidence) ? args.insight.evidence : [],
        score: isRecord(args.insight.score) ? args.insight.score : null,
        measurementStatus: 'pending',
        baseline: {
          metric,
          value: baselineValue,
          capturedAt: args.now.toISOString(),
        },
        target: {
          expectedDirection: outcomeMeasurement.expectedDirection,
          reviewAfterAt: reviewAt,
        },
      },
    },
  })
}

export async function convertApprovedBusinessInsightReviewTask(
  input: ConvertBusinessInsightInput,
): Promise<ConversionOk | ConversionError> {
  const actorType = input.actorType ?? 'user'
  const now = input.now ?? new Date()
  const reviewRef = adminDb.collection('projects').doc(input.projectId).collection('tasks').doc(input.reviewTaskId)
  const reviewSnap = await reviewRef.get()
  if (!reviewSnap.exists) return { ok: false, status: 404, error: 'Business insight review task not found' }

  const task = (reviewSnap.data() ?? {}) as Record<string, unknown>
  const insight = insightData(task)
  if (!insight || insight.type !== 'business-insight-review') {
    return { ok: false, status: 400, error: 'Task is not a business insight review' }
  }
  if (task.reviewStatus !== 'approved') {
    return { ok: false, status: 409, error: 'Business insight review must be approved before conversion' }
  }

  const existingActionTaskId = existingConversionActionTaskId(insight)
  if (existingActionTaskId) {
    return {
      ok: true,
      created: false,
      projectId: input.projectId,
      reviewTaskId: input.reviewTaskId,
      actionTaskId: existingActionTaskId,
    }
  }

  const nextActionTaskId = actionTaskId(input.projectId, input.reviewTaskId, cleanString(insight.suppressionKey))
  const payload = buildActionTaskPayload({
    projectId: input.projectId,
    reviewTaskId: input.reviewTaskId,
    task,
    insight,
    actionTaskId: nextActionTaskId,
    actorId: input.actorId,
    actorType,
    now,
  })
  if (isConversionError(payload)) return payload

  const actionRef = adminDb.collection('projects').doc(input.projectId).collection('tasks').doc(nextActionTaskId)
  await actionRef.set(payload, { merge: true })
  await reviewRef.set(stripUndefined({
    metadata: {
      businessInsightReview: {
        ...insight,
        conversion: {
          status: 'converted',
          actionTaskId: nextActionTaskId,
          convertedBy: input.actorId,
          convertedByType: actorType,
          convertedAt: FieldValue.serverTimestamp(),
        },
      },
    },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorId,
    updatedByType: actorType,
  }), { merge: true })

  return {
    ok: true,
    created: true,
    projectId: input.projectId,
    reviewTaskId: input.reviewTaskId,
    actionTaskId: nextActionTaskId,
  }
}
