import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import type { GraphTemplate, MaterializeIntent, WorkflowRun } from './types'
import { inspectWorkflowRun } from './engine'

const TEMPLATES = 'graph_templates'
const RUNS = 'workflow_runs'

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

export async function materializeKanbanTask(input: {
  projectId: string
  orgId: string
  run: WorkflowRun
  intent: MaterializeIntent
  actorUid: string
}): Promise<{ ok: true; taskId: string; created: boolean } | { ok: false; error: string; status?: number }> {
  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const tasksRef = projectRef.collection('tasks')

  // Idempotent reuse: look for existing task with workflow labels
  const existing = await tasksRef
    .where('workflowRunId', '==', input.run.id)
    .where('workflowNodeId', '==', intentNodeId(input.intent))
    .limit(1)
    .get()
    .catch(() => null)

  if (existing && !existing.empty) {
    return { ok: true, taskId: existing.docs[0].id, created: false }
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
  return inspectWorkflowRun(run)
}
