import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import type { GraphTemplate, MaterializeIntent, WorkflowOpsFact, WorkflowRun } from './types'
import { buildOpsInspect } from './ops'
import { inspectWorkflowRun } from './engine'

const TEMPLATES = 'graph_templates'
const RUNS = 'workflow_runs'
const OPS_FACTS = 'workflow_ops_facts'

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

export async function saveGraphTemplate(template: GraphTemplate, actorUid: string): Promise<GraphTemplate> {
  const ref = template.id
    ? adminDb.collection(TEMPLATES).doc(template.id)
    : adminDb.collection(TEMPLATES).doc()
  const now = new Date().toISOString()
  const payload = stripUndefined({
    ...template,
    id: ref.id,
    createdAt: template.createdAt || now,
    updatedAt: now,
    createdBy: template.createdBy || actorUid,
    updatedBy: actorUid,
  })
  await ref.set(payload, { merge: true })
  return payload as GraphTemplate
}

export async function getGraphTemplate(templateId: string): Promise<GraphTemplate | null> {
  const snap = await adminDb.collection(TEMPLATES).doc(templateId).get()
  if (!snap.exists) return null
  return { id: snap.id, ...(snap.data() as GraphTemplate) }
}

export async function listGraphTemplates(orgId: string, limit = 50): Promise<GraphTemplate[]> {
  const snap = await adminDb
    .collection(TEMPLATES)
    .where('orgId', '==', orgId)
    .limit(Math.min(Math.max(limit, 1), 100))
    .get()
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as GraphTemplate) }))
}

export async function saveWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> {
  if (!run.id) throw new Error('WorkflowRun.id is required')
  const ref = adminDb.collection(RUNS).doc(run.id)
  const payload = stripUndefined({
    ...run,
    updatedAt: run.updatedAt || new Date().toISOString(),
  } as Record<string, unknown>)
  await ref.set(payload, { merge: true })
  return run
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun | null> {
  const snap = await adminDb.collection(RUNS).doc(runId).get()
  if (!snap.exists) return null
  return { id: snap.id, ...(snap.data() as WorkflowRun) }
}

export async function findWorkflowRunByIdempotencyKey(
  orgId: string,
  idempotencyKey: string,
): Promise<WorkflowRun | null> {
  const snap = await adminDb
    .collection(RUNS)
    .where('orgId', '==', orgId)
    .where('createIdempotencyKey', '==', idempotencyKey)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, ...(doc.data() as WorkflowRun) }
}

export async function listWorkflowRuns(input: {
  orgId: string
  status?: string
  limit?: number
}): Promise<WorkflowRun[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  let query: {
    where: (field: string, op: string, value: unknown) => typeof query
    limit: (n: number) => { get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> }
  } = adminDb.collection(RUNS).where('orgId', '==', input.orgId) as never

  const virtual = new Set(['stuck', 'blocked', 'paused', 'paused_budget'])
  if (input.status && !virtual.has(input.status)) {
    query = query.where('status', '==', input.status)
  } else if (input.status === 'paused_budget' || input.status === 'paused') {
    query = query.where('status', '==', 'paused_budget')
  }

  const snap = await query.limit(limit * 2).get()
  let runs = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as WorkflowRun) }))

  if (input.status === 'stuck') {
    runs = runs.filter((run) => Boolean(run.stuckReasonCode) || Boolean(run.stuckAt))
  } else if (input.status === 'blocked') {
    runs = runs.filter(
      (run) =>
        run.status === 'failed'
        || Boolean(run.blockedReasonCode)
        || run.nodes.some((n) => n.status === 'blocked'),
    )
  }

  return runs.slice(0, limit)
}

export async function saveOpsFact(fact: WorkflowOpsFact): Promise<{ written: boolean; fact: WorkflowOpsFact }> {
  const ref = adminDb.collection(OPS_FACTS).doc(fact.dedupeKey.replace(/[^a-zA-Z0-9:_-]/g, '_'))
  const existing = await ref.get()
  if (existing.exists) {
    const data = existing.data() as WorkflowOpsFact
    return { written: false, fact: { ...data, id: existing.id } }
  }
  const payload = stripUndefined({ ...fact, id: ref.id } as Record<string, unknown>)
  await ref.set(payload)
  return { written: true, fact: payload as WorkflowOpsFact }
}

export async function listOpsFacts(orgId: string, limit = 50): Promise<WorkflowOpsFact[]> {
  const snap = await adminDb
    .collection(OPS_FACTS)
    .where('orgId', '==', orgId)
    .limit(Math.min(Math.max(limit, 1), 100))
    .get()
  return snap.docs.map((doc) => {
    const data = doc.data() as WorkflowOpsFact
    return { ...data, id: doc.id }
  })
}

export async function materializeKanbanTask(input: {
  projectId: string
  orgId: string
  run: WorkflowRun
  intent: MaterializeIntent
  actorUid: string
}): Promise<{ ok: true; taskId: string; created: boolean } | { ok: false; error: string; status?: number }> {
  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const tasksRef = projectRef.collection('tasks')

  const existing = await tasksRef
    .where('workflowRunId', '==', input.run.id)
    .where('workflowNodeId', '==', intentNodeId(input.intent))
    .limit(1)
    .get()
    .catch(() => null)

  if (existing && !existing.empty) {
    const doc = existing.docs[0]
    const taskId = doc.id
    if (input.intent.requeueExisting) {
      await doc.ref.update({
        agentStatus: input.intent.agentStatus,
        columnId: input.intent.columnId,
        reviewStatus: 'changes-requested',
        labels: input.intent.labels,
        agentInput: input.intent.agentInput ?? FieldValue.delete(),
        workflowAttempt: input.intent.agentInput?.context?.workflowAttempt ?? FieldValue.increment(1),
        agentOutput: FieldValue.delete(),
        agentConversationId: FieldValue.delete(),
        agentHeartbeatAt: FieldValue.delete(),
        blockedReason: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    return { ok: true, taskId, created: false }
  }

  const taskRef = tasksRef.doc()
  const isGate = input.intent.kind === 'human_gate'
  const built = buildProjectTaskCreateData({
    title: input.intent.title,
    description: `Workflow run ${input.run.id} node ${input.intent.nodeId}`,
    columnId: input.intent.columnId,
    priority: input.intent.riskLevel === 'high' ? 'high' : 'medium',
    labels: input.intent.labels,
    assigneeAgentId: input.intent.assigneeAgentId,
    agentStatus: input.intent.agentStatus,
    reviewerAgentId: input.intent.reviewerAgentId,
    requiredCapability: input.intent.requiredCapability,
    riskLevel: input.intent.riskLevel,
    approvalGate: input.intent.approvalGate,
    expectedArtifacts: input.intent.expectedArtifacts,
    verifierChecklist: input.intent.verifierChecklist,
    dependsOn: input.intent.dependsOnKanbanTaskIds,
    agentInput: input.intent.agentInput,
    order: Date.now(),
  }, input.projectId, input.orgId)

  if (!built.ok) return { ok: false, error: built.error, status: built.status }

  await taskRef.set({
    ...built.value,
    ...(isGate ? { approvalStatus: 'pending' } : {}),
    workflowRunId: input.run.id,
    workflowNodeId: input.intent.nodeId,
    workflowTemplateId: input.run.templateId,
    workflowAttempt: input.intent.agentInput?.context?.workflowAttempt ?? 1,
    reporterId: input.actorUid,
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { ok: true, taskId: taskRef.id, created: true }
}

function intentNodeId(intent: MaterializeIntent): string {
  return intent.nodeId
}

export function toInspectPayload(run: WorkflowRun) {
  return buildOpsInspect(run)
}

export function toLegacyInspectPayload(run: WorkflowRun) {
  return inspectWorkflowRun(run)
}
