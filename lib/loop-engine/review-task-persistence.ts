import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import type { ConservativeReviewTaskDraft } from './review-evaluator'

type CreatedReviewTask = {
  draftId: string
  taskId: string
  projectId: string
  orgId: string
  loopId: ConservativeReviewTaskDraft['loopId']
}

type SkippedReviewTask = {
  draftId: string
  loopId: ConservativeReviewTaskDraft['loopId']
  reason:
    | 'missing-project-id'
    | 'missing-org-id'
    | 'non-internal-side-effect-policy'
    | 'approval-not-required'
    | 'invalid-task-payload'
}

export type PersistConservativeReviewTaskDraftsInput = {
  drafts: ConservativeReviewTaskDraft[]
  projectId?: string | null
  actorId?: string
  createdByType?: 'user' | 'agent' | 'system'
}

export type PersistConservativeReviewTaskDraftsResult = {
  created: CreatedReviewTask[]
  skipped: SkippedReviewTask[]
}

const REVIEW_TASK_CONSTRAINTS = [
  'internal review only',
  'no automatic external send, public publish, paid spend, finance, secret/config, production deploy, destructive data change, skill rewrite, or wiki rewrite',
]

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function reviewTaskId(idempotencyKey: string): string {
  const hash = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 20)
  return `loop-review-${hash}`
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

function skip(draft: ConservativeReviewTaskDraft, reason: SkippedReviewTask['reason']): SkippedReviewTask {
  return { draftId: draft.idempotencyKey, loopId: draft.loopId, reason }
}

function labelsForDraft(draft: ConservativeReviewTaskDraft): string[] {
  return Array.from(new Set([
    'loop-review',
    draft.loopId,
    draft.requiredCapability,
    'internal-only',
    'approval-required',
  ]))
}

function buildTaskPayload(
  draft: ConservativeReviewTaskDraft,
  projectId: string,
  actorId: string,
  createdByType: PersistConservativeReviewTaskDraftsInput['createdByType'],
): Record<string, unknown> | null {
  const built = buildProjectTaskCreateData({
    orgId: draft.orgId,
    title: draft.title,
    description: draft.description,
    columnId: draft.columnId,
    priority: 'high',
    labels: labelsForDraft(draft),
    internalOnly: true,
    assigneeAgentId: draft.assigneeAgentId,
    agentStatus: draft.agentStatus,
    reviewerAgentId: draft.reviewerAgentId,
    riskLevel: draft.riskLevel,
    requiredCapability: draft.requiredCapability,
    agentInput: {
      spec: draft.description,
      context: {
        ...draft.agentInput.context,
        orgId: draft.orgId,
        projectId,
        loopId: draft.loopId,
        idempotencyKey: draft.idempotencyKey,
        requiredCapability: draft.requiredCapability,
        reviewerAgentId: draft.reviewerAgentId,
        sideEffectPolicy: draft.sideEffectPolicy,
      },
      constraints: REVIEW_TASK_CONSTRAINTS,
    },
  }, projectId, draft.orgId)

  if (!built.ok) return null

  return stripUndefined({
    ...built.value,
    status: draft.status,
    reviewStatus: draft.reviewStatus,
    requiresApproval: draft.requiresApproval,
    approvalStatus: draft.approvalStatus,
    sideEffectPolicy: draft.sideEffectPolicy,
    sourceOrigin: 'loop-engine',
    origin: draft.loopId,
    originType: 'loop-review',
    reporterId: actorId,
    createdBy: actorId,
    createdByType,
    updatedBy: actorId,
    updatedByType: createdByType,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    metadata: {
      ...draft.metadata,
      loopReviewDraft: {
        schemaVersion: 1,
        idempotencyKey: draft.idempotencyKey,
        loopId: draft.loopId,
        sideEffectPolicy: draft.sideEffectPolicy,
        persistedBy: actorId,
        persistedByType: createdByType,
      },
    },
  })
}

export async function persistConservativeReviewTaskDrafts(
  input: PersistConservativeReviewTaskDraftsInput,
): Promise<PersistConservativeReviewTaskDraftsResult> {
  const created: CreatedReviewTask[] = []
  const skipped: SkippedReviewTask[] = []
  const actorId = cleanString(input.actorId) ?? 'pip'
  const createdByType = input.createdByType ?? 'agent'

  for (const draft of input.drafts) {
    if (draft.sideEffectPolicy !== 'internal-review-only') {
      skipped.push(skip(draft, 'non-internal-side-effect-policy'))
      continue
    }
    if (draft.requiresApproval !== true || draft.approvalStatus !== 'pending') {
      skipped.push(skip(draft, 'approval-not-required'))
      continue
    }

    const projectId = cleanString(draft.projectId) ?? cleanString(input.projectId)
    if (!projectId) {
      skipped.push(skip(draft, 'missing-project-id'))
      continue
    }
    const orgId = cleanString(draft.orgId)
    if (!orgId) {
      skipped.push(skip(draft, 'missing-org-id'))
      continue
    }

    const payload = buildTaskPayload(draft, projectId, actorId, createdByType)
    if (!payload) {
      skipped.push(skip(draft, 'invalid-task-payload'))
      continue
    }

    const taskId = reviewTaskId(draft.idempotencyKey)
    await adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId).set(payload, { merge: true })
    created.push({
      draftId: draft.idempotencyKey,
      taskId,
      projectId,
      orgId,
      loopId: draft.loopId,
    })
  }

  return { created, skipped }
}
