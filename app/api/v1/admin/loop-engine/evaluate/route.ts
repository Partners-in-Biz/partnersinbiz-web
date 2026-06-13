import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { evaluateLoopRun } from '@/lib/loop-engine/executor'
import { buildConservativeReviewTaskDrafts, type AgentEvolutionSignal, type BusinessInsightSignal } from '@/lib/loop-engine/review-evaluator'
import { persistConservativeReviewTaskDrafts } from '@/lib/loop-engine/review-task-persistence'
import type { LoopRunCandidate, LoopRunTrigger } from '@/lib/loop-engine/runs'
import type { LoopApprovalGate } from '@/lib/loop-engine/registry'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanString).filter((item): item is string => Boolean(item))))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cleanCandidates(value: unknown): LoopRunCandidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): LoopRunCandidate[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Record<string, unknown>
    const id = cleanString(source.id)
    const title = cleanString(source.title)
    const type = cleanString(source.type)
    if (!id || !title || !type || !['task', 'lead', 'seo-signal', 'review-item', 'manual'].includes(type)) return []
    return [{
      id,
      title,
      type: type as LoopRunCandidate['type'],
      orgId: cleanString(source.orgId),
      projectId: cleanString(source.projectId),
      taskId: cleanString(source.taskId),
      riskLevel: cleanString(source.riskLevel),
      requiredCapability: cleanString(source.requiredCapability),
      approvalGateTaskId: cleanString(source.approvalGateTaskId),
      approvalGateStatus: cleanString(source.approvalGateStatus),
      task: source.task && typeof source.task === 'object' && !Array.isArray(source.task) ? source.task as Record<string, unknown> : null,
      context: source.context && typeof source.context === 'object' && !Array.isArray(source.context) ? source.context as Record<string, unknown> : undefined,
    }]
  })
}

function cleanSourceWindow(value: unknown, fallback: { from: string; to: string }): { from: string; to: string } {
  if (!isRecord(value)) return fallback
  const from = cleanString(value.from)
  const to = cleanString(value.to)
  if (!from || !to) return fallback
  return { from, to }
}

const AGENT_SIGNAL_CATEGORIES = new Set([
  'stale-instruction',
  'missing-context',
  'repeat-blocker',
  'review-rework',
  'weak-output',
  'unsafe-request',
  'tooling-gap',
])

const BUSINESS_SIGNAL_LANES = new Set([
  'crm',
  'seo',
  'ads',
  'social',
  'support',
  'invoice',
  'project',
  'agent-output',
  'data-quality',
])

const BUSINESS_INSIGHT_KINDS = new Set([
  'opportunity',
  'risk',
  'missing-data',
  'stale-work',
  'performance-drop',
  'follow-up-gap',
])

const LOOP_APPROVAL_GATES = new Set<LoopApprovalGate>([
  'client-visible',
  'public-publishing',
  'paid-spend',
  'production-deploy',
  'finance',
  'secret-config',
  'destructive-data',
  'human-review',
])

function cleanSourceLink(value: unknown): AgentEvolutionSignal['source'] | null {
  if (!isRecord(value)) return null
  const type = cleanString(value.type)
  const label = cleanString(value.label)
  if (!type || !label) return null
  return {
    type,
    id: cleanString(value.id) ?? undefined,
    href: cleanString(value.href) ?? undefined,
    label,
  }
}

function cleanSourceLinks(value: unknown): BusinessInsightSignal['sourceLinks'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const link = cleanSourceLink(item)
    return link ? [link] : []
  })
}

function cleanEvidence(value: unknown): BusinessInsightSignal['evidence'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const label = cleanString(item.label)
    if (!label) return []
    const evidence: BusinessInsightSignal['evidence'][number] = { label }
    if (typeof item.value === 'string' || typeof item.value === 'number') evidence.value = item.value
    const href = cleanString(item.href)
    if (href) evidence.href = href
    return [evidence]
  })
}

function cleanAgentSignals(value: unknown): AgentEvolutionSignal[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((signal): AgentEvolutionSignal[] => {
    if (!isRecord(signal)) return []
    const id = cleanString(signal.id)
    const category = cleanString(signal.category)
    const targetSurface = cleanString(signal.targetSurface)
    const title = cleanString(signal.title)
    const summary = cleanString(signal.summary)
    const source = cleanSourceLink(signal.source)
    if (!id || !category || !AGENT_SIGNAL_CATEGORIES.has(category) || !targetSurface || !title || !summary || !source) return []
    return [{
      id,
      category: category as AgentEvolutionSignal['category'],
      targetSurface,
      title,
      summary,
      severity: cleanNumber(signal.severity),
      confidence: cleanNumber(signal.confidence),
      easeOfFix: cleanNumber(signal.easeOfFix),
      risk: cleanNumber(signal.risk),
      source,
      occurredAt: cleanString(signal.occurredAt) ?? undefined,
    }]
  })
}

function cleanBusinessSignals(value: unknown): BusinessInsightSignal[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((signal): BusinessInsightSignal[] => {
    if (!isRecord(signal)) return []
    const id = cleanString(signal.id)
    const lane = cleanString(signal.lane)
    const insightKind = cleanString(signal.insightKind)
    const summary = cleanString(signal.summary)
    const impactEstimate = cleanString(signal.impactEstimate)
    const nextAction = cleanString(signal.nextAction)
    const suppressionKey = cleanString(signal.suppressionKey)
    const sourceLinks = cleanSourceLinks(signal.sourceLinks)
    const approvalGate = cleanString(signal.approvalGate)
    if (
      !id
      || !lane
      || !BUSINESS_SIGNAL_LANES.has(lane)
      || !insightKind
      || !BUSINESS_INSIGHT_KINDS.has(insightKind)
      || !summary
      || !impactEstimate
      || !nextAction
      || !suppressionKey
      || sourceLinks.length === 0
    ) {
      return []
    }
    return [{
      id,
      lane: lane as BusinessInsightSignal['lane'],
      insightKind: insightKind as BusinessInsightSignal['insightKind'],
      summary,
      impactEstimate,
      metric: cleanString(signal.metric) ?? undefined,
      value: typeof signal.value === 'number' && Number.isFinite(signal.value) ? signal.value : undefined,
      impact: cleanNumber(signal.impact),
      urgency: cleanNumber(signal.urgency),
      confidence: cleanNumber(signal.confidence),
      actionability: cleanNumber(signal.actionability),
      risk: cleanNumber(signal.risk),
      ownerAgentId: cleanString(signal.ownerAgentId) ?? undefined,
      ownerRole: cleanString(signal.ownerRole) ?? undefined,
      approvalGate: approvalGate && LOOP_APPROVAL_GATES.has(approvalGate as LoopApprovalGate)
        ? approvalGate as LoopApprovalGate
        : undefined,
      nextAction,
      suppressionKey,
      sourceLinks,
      evidence: cleanEvidence(signal.evidence),
      blocksActiveCommercialLoop: signal.blocksActiveCommercialLoop === true,
      hasNewSourceItem: signal.hasNewSourceItem === true,
      hasMetricDelta: signal.hasMetricDelta === true,
      hasReviewerStatusChange: signal.hasReviewerStatusChange === true,
    }]
  })
}

function loopRunTelemetry(input: {
  source: string
  startedAtMs: number
  startedAt: string
  candidateCount: number
  proposedActionCount: number
  executedActionCount: number
  reviewDraftCount: number
  persistedReviewTaskCount: number
  skippedReviewTaskCount: number
}) {
  const completedAtMs = Date.now()
  const durationMs = Math.max(0, completedAtMs - input.startedAtMs)
  const completedAt = new Date(completedAtMs).toISOString()
  return {
    usage: {
      durationMs,
      retryCount: 0,
      toolCallCount: 0,
    },
    runtime: {
      source: input.source,
      startedAt: input.startedAt,
      completedAt,
      durationMs,
      candidateCount: input.candidateCount,
      proposedActionCount: input.proposedActionCount,
      executedActionCount: input.executedActionCount,
      reviewDraftCount: input.reviewDraftCount,
      persistedReviewTaskCount: input.persistedReviewTaskCount,
      skippedReviewTaskCount: input.skippedReviewTaskCount,
    },
    telemetry: {
      source: input.source,
      startedAt: input.startedAt,
      completedAt,
      durationMs,
      operationCount: input.candidateCount + input.reviewDraftCount + input.persistedReviewTaskCount,
    },
  }
}

function cleanTrigger(value: unknown): LoopRunTrigger | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const kind = cleanString(source.kind)
  if (!kind) return undefined
  return {
    kind: kind as LoopRunTrigger['kind'],
    ref: cleanString(source.ref),
    source: cleanString(source.source),
  }
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const orgId = cleanString(body.orgId) ?? req.headers.get('x-org-id')
  const loopId = cleanString(body.loopId)
  if (!orgId) return apiError('orgId is required', 400)
  if (!loopId) return apiError('loopId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError(`You do not have access to orgId ${orgId}`, 403)

  const dryRun = cleanBool(body.dryRun, true)
  const persist = cleanBool(body.persist, false)
  const run = evaluateLoopRun({
    loopId,
    orgId,
    candidates: cleanCandidates(body.candidates),
    trigger: cleanTrigger(body.trigger),
    dryRun,
    createdBy: user.agentId ?? user.uid,
    createdByType: user.role === 'ai' ? 'agent' : 'user',
    idempotencyKey: cleanString(body.idempotencyKey) ?? undefined,
  })

  const projectId = cleanString(body.projectId)
  const reviewDrafts = buildConservativeReviewTaskDrafts({
    orgId,
    projectId,
    sourceWindow: cleanSourceWindow(body.sourceWindow, { from: run.createdAt, to: run.updatedAt }),
    agentSignals: cleanAgentSignals(body.agentSignals),
    businessSignals: cleanBusinessSignals(body.businessSignals),
    existingSuppressionKeys: cleanStringArray(body.existingSuppressionKeys),
  })
  const reviewTaskPersistence = cleanBool(body.persistReviewTasks, false)
    ? await persistConservativeReviewTaskDrafts({
      drafts: reviewDrafts,
      projectId,
      actorId: user.agentId ?? user.uid,
      createdByType: user.role === 'ai' ? 'agent' : 'user',
    })
    : { created: [], skipped: [] }

  if (persist) {
    await adminDb.collection('loop_engine_runs').doc(run.id).set({
      ...run,
      ...loopRunTelemetry({
        source: 'admin-loop-engine-evaluate',
        startedAtMs,
        startedAt,
        candidateCount: run.candidates.length,
        proposedActionCount: run.proposedActions.length,
        executedActionCount: run.executedActions.length,
        reviewDraftCount: reviewDrafts.length,
        persistedReviewTaskCount: reviewTaskPersistence.created.length,
        skippedReviewTaskCount: reviewTaskPersistence.skipped.length,
      }),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  return apiSuccess({ run, persisted: persist, reviewDrafts, reviewTaskPersistence })
})
