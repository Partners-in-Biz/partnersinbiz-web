/**
 * GET    /api/v1/tasks/:id — fetch a single task
 * PUT    /api/v1/tasks/:id — update a task
 * DELETE /api/v1/tasks/:id — soft delete (?force=true hard-deletes)
 *
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { cleanAgentEffort, cleanAgentModel, VALID_AGENT_EFFORTS, VALID_AGENT_MODELS } from '@/lib/agents/runRouting'
import {
  VALID_TASK_STATUSES,
  VALID_TASK_PRIORITIES,
  VALID_ASSIGNEE_TYPES,
  VALID_AGENT_IDS,
  VALID_AGENT_STATUSES,
  type Task,
  type TaskAssignee,
  type TaskPriority,
  type TaskStatus,
  type AgentId,
  type AgentStatus,
} from '@/lib/tasks/types'
import {
  applyAgentColumnForUpdate,
  applyAgentTodoRequeue,
  applyStandaloneTaskStatusForAgentStatus,
} from '@/lib/tasks/agentState'
import {
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS,
  RESOURCE_RELATIONSHIP_STRING_FIELDS,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'
import { buildBlockedTaskRecovery } from '@/lib/projects/blockerRecovery'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  for (const key of RESOURCE_RELATIONSHIP_STRING_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  for (const key of RESOURCE_RELATIONSHIP_ARRAY_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withAuth('admin', async (_req, _user, context) => {
  const { id } = await (context as RouteContext).params
  const doc = await adminDb.collection('tasks').doc(id).get()
  if (!doc.exists) return apiError('Task not found', 404)
  const data = doc.data() as Task | undefined
  if (!data || data.deleted === true) return apiError('Task not found', 404)
  return apiSuccess({ ...data, id: doc.id })
})

const UPDATABLE_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'dueDate',
  'assignedTo',
  'projectId',
  'contactId',
  'dealId',
  'tags',
  'columnId',
  'reviewStatus',
  'assigneeAgentId',
  'agentStatus',
  'agentInput',
  'agentOutput',
  'agentEffort',
  'agentModel',
  'agentConversationId',
  'dependsOn',
] as const

export const PUT = withAuth('admin', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection('tasks').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)
  const existing = doc.data() as Task | undefined
  if (!existing || existing.deleted === true) {
    return apiError('Task not found', 404)
  }

  const body = (await req.json()) as Record<string, unknown>

  // Validate enum fields where present.
  if (
    body.status !== undefined &&
    !VALID_TASK_STATUSES.includes(body.status as TaskStatus)
  ) {
    return apiError('Invalid status; expected todo | in_progress | done | cancelled')
  }
  if (
    body.priority !== undefined &&
    !VALID_TASK_PRIORITIES.includes(body.priority as TaskPriority)
  ) {
    return apiError('Invalid priority; expected low | normal | high | urgent')
  }
  if (body.assignedTo !== undefined && body.assignedTo !== null) {
    const a = body.assignedTo as TaskAssignee
    if (!a || !VALID_ASSIGNEE_TYPES.includes(a.type) || !a.id) {
      return apiError("Invalid assignedTo; expected { type: 'user'|'agent', id }")
    }
  }

  // Agent dispatch validation
  if (body.assigneeAgentId !== undefined && body.assigneeAgentId !== null && body.assigneeAgentId !== '') {
    if (typeof body.assigneeAgentId !== 'string' || !VALID_AGENT_IDS.includes(body.assigneeAgentId as AgentId)) {
      return apiError(`Invalid assigneeAgentId; expected one of ${VALID_AGENT_IDS.join(' | ')}`)
    }
  }
  if (body.agentStatus !== undefined && body.agentStatus !== null) {
    if (typeof body.agentStatus !== 'string' || !VALID_AGENT_STATUSES.includes(body.agentStatus as AgentStatus)) {
      return apiError(`Invalid agentStatus; expected one of ${VALID_AGENT_STATUSES.join(' | ')}`)
    }
  }
  if (body.agentEffort !== undefined && body.agentEffort !== null && body.agentEffort !== '') {
    if (!cleanAgentEffort(body.agentEffort)) {
      return apiError(`Invalid agentEffort; expected one of ${VALID_AGENT_EFFORTS.join(' | ')}`)
    }
  }
  if (body.agentModel !== undefined && body.agentModel !== null && body.agentModel !== '') {
    if (!cleanAgentModel(body.agentModel)) {
      return apiError(`Invalid agentModel; expected one of ${VALID_AGENT_MODELS.join(' | ')}`)
    }
  }
  if (body.agentInput !== undefined && body.agentInput !== null) {
    const ai = body.agentInput as Record<string, unknown>
    if (typeof ai !== 'object' || Array.isArray(ai) || typeof ai.spec !== 'string' || !ai.spec.trim()) {
      return apiError('agentInput must be { spec: string, context?, constraints? }')
    }
  }
  if (body.agentOutput !== undefined && body.agentOutput !== null) {
    const ao = body.agentOutput as Record<string, unknown>
    if (typeof ao !== 'object' || Array.isArray(ao) || typeof ao.summary !== 'string' || !ao.summary.trim()) {
      return apiError('agentOutput must be { summary: string, artifacts?, completedAt? }')
    }
  }
  if (body.dependsOn !== undefined && !Array.isArray(body.dependsOn)) {
    return apiError('dependsOn must be an array of task IDs')
  }

  const updates: Record<string, unknown> = {}
  for (const key of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (body.agentEffort !== undefined) {
    updates.agentEffort = cleanAgentEffort(body.agentEffort) ?? null
  }
  if (body.agentModel !== undefined) {
    updates.agentModel = cleanAgentModel(body.agentModel) ?? null
  }

  const relationshipInput = relationshipInputFrom(body)
  if (relationshipInput) {
    const relationships = normalizeResourceRelationshipLinks(relationshipInput)
    if (!relationships.ok) return apiError(relationships.error, 400)
    Object.assign(updates, relationships.value)
  }

  // Re-assigning to a new agent auto-resets agentStatus unless caller set it explicitly.
  if (body.assigneeAgentId !== undefined && body.agentStatus === undefined) {
    updates.agentStatus = body.assigneeAgentId ? 'pending' : null
  }
  applyAgentColumnForUpdate(updates, body)
  applyStandaloneTaskStatusForAgentStatus(updates, body)
  const finalUpdates = applyAgentTodoRequeue(existing as unknown as Record<string, unknown>, updates, body)

  // Heartbeat sentinel — caller passes agentHeartbeatAt:true to bump server timestamp.
  if (body.agentHeartbeatAt === true) {
    finalUpdates.agentHeartbeatAt = FieldValue.serverTimestamp()
  }

  // Status transition side effects.
  if (
    finalUpdates.status === 'done' &&
    existing.status !== 'done'
  ) {
    finalUpdates.completedAt = FieldValue.serverTimestamp()
  }

  const assigneeChanged =
    body.assignedTo !== undefined &&
    JSON.stringify(body.assignedTo) !== JSON.stringify(existing.assignedTo ?? null)

  await ref.update({
    ...finalUpdates,
    ...lastActorFrom(user),
  })

  if (existing.orgId) {
    logActivity({
      orgId: existing.orgId,
      type: 'task_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated task',
      entityId: id,
      entityType: 'task',
      entityTitle: (finalUpdates.title as string | undefined) ?? existing.title,
    }).catch(() => {})
  }

  // Notify reporter when agent marks task done.
  const agentJustDone = finalUpdates.agentStatus === 'done' && existing.agentStatus !== 'done'
  if (agentJustDone && existing.orgId) {
    const reporterId = typeof existing.createdBy === 'string' ? existing.createdBy : null
    const agentId = typeof finalUpdates.assigneeAgentId === 'string' ? finalUpdates.assigneeAgentId : typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : 'agent'
    if (reporterId && reporterId !== user.uid) {
      adminDb.collection('notifications').add({
        orgId: existing.orgId,
        userId: reporterId,
        agentId: null,
        type: 'task.agent_done',
        title: `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} finished a task`,
        body: (finalUpdates.title as string | undefined) ?? existing.title ?? 'Task',
        link: `/portal/projects?task=${id}`,
        status: 'unread',
        priority: (finalUpdates.priority as string | undefined) ?? existing.priority ?? 'medium',
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
    }
  }

  const agentJustNeedsInput = (finalUpdates.agentStatus === 'awaiting-input' || finalUpdates.agentStatus === 'blocked')
    && finalUpdates.agentStatus !== existing.agentStatus
  if (agentJustNeedsInput && existing.orgId) {
    const reporterId = typeof existing.createdBy === 'string' ? existing.createdBy : null
    const agentId = typeof finalUpdates.assigneeAgentId === 'string' ? finalUpdates.assigneeAgentId : typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : 'agent'
    const recovery = buildBlockedTaskRecovery({ ...existing, ...finalUpdates, id })
    if (reporterId && reporterId !== user.uid) {
      adminDb.collection('notifications').add({
        orgId: existing.orgId,
        userId: reporterId,
        agentId,
        type: 'task.agent_needs_input',
        title: `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} needs Peet to continue`,
        body: `Exact blocker: ${recovery.blockingReason}. Proof needed: ${recovery.requiredEvidence}. Message for agent: ${recovery.messageForAgent}`,
        link: `/portal/projects?task=${id}`,
        data: {
          taskId: id,
          taskTitle: (finalUpdates.title as string | undefined) ?? existing.title ?? 'Task',
          blockerReason: recovery.blockingReason,
          safeContinuePath: `${recovery.continueActionLabel}: add approval/input evidence in the task drawer, then use the safe continue/unblock action.`,
        },
        status: 'unread',
        priority: 'high',
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
    }
  }

  // Notify the new assignee if it changed to a non-null value.
  if (assigneeChanged && body.assignedTo) {
    const a = body.assignedTo as TaskAssignee
    const title = (finalUpdates.title as string | undefined) ?? existing.title
    const priority =
      (finalUpdates.priority as TaskPriority | undefined) ?? existing.priority
    const dueDate =
      (finalUpdates.dueDate as string | null | undefined) ?? existing.dueDate

    await adminDb.collection('notifications').add({
      orgId: existing.orgId,
      userId: a.type === 'user' ? a.id : null,
      agentId: a.type === 'agent' ? a.id : null,
      type: 'task.assigned',
      title: 'Task assigned to you',
      body: `"${title}" — due ${dueDate ?? 'no date'}`,
      link: `/portal/projects?task=${id}`,
      status: 'unread',
      priority,
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  return apiSuccess({ id, ...finalUpdates })
})

export const DELETE = withAuth('admin', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection('tasks').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const { searchParams } = new URL(req.url)
  const force = searchParams.get('force') === 'true'

  if (force) {
    await ref.delete()
  } else {
    await ref.update({
      deleted: true,
      ...lastActorFrom(user),
    })
  }

  const deletedOrgId = doc.data()?.orgId as string | undefined
  if (deletedOrgId) {
    logActivity({
      orgId: deletedOrgId,
      type: 'task_deleted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Deleted task',
      entityId: id,
      entityType: 'task',
    }).catch(() => {})
  }

  return apiSuccess({ id, deleted: true })
})
