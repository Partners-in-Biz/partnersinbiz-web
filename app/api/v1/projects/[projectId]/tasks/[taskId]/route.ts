import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import {
  applyAgentColumnMoveState,
  buildProjectTaskUpdateData,
  notificationPriority,
} from '@/lib/projects/taskPayload'
import { logActivity } from '@/lib/activity/log'
import { adminProjectTaskLink } from '@/lib/projects/links'
import { buildBlockedTaskRecovery } from '@/lib/projects/blockerRecovery'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds, type ContextReference } from '@/lib/context-references/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function agentInputWithContextRefs(
  agentInput: unknown,
  contextRefs: ContextReference[],
): Record<string, unknown> | null {
  if (!isRecord(agentInput)) return null
  const existingContext = isRecord(agentInput.context) ? agentInput.context : {}
  return {
    ...agentInput,
    context: {
      ...existingContext,
      contextRefs,
    },
  }
}

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const existing = doc.data() ?? {}
  const labels = Array.isArray(existing.labels) ? existing.labels.map((label) => String(label).toLowerCase()) : []
  const existingGate = typeof existing.approvalGate === 'string' && existing.approvalGate && existing.approvalGate !== 'none'
  const nextGate = typeof body.approvalGate === 'string' && body.approvalGate && body.approvalGate !== 'none'
  const existingApprovalStatus = typeof existing.approvalStatus === 'string' && existing.approvalStatus.trim().length > 0
  const existingApprovalGateTaskId = typeof existing.approvalGateTaskId === 'string' && existing.approvalGateTaskId.trim().length > 0
  const isApprovalGatedTask = labels.some((label) => /approval-gate|approval-required|client-approval|required-approval/.test(label)) || existingApprovalStatus || existingGate || nextGate || existingApprovalGateTaskId
  const approvalGateFields = ['approvalGate', 'requiredCapability', 'riskLevel', 'expectedArtifacts', 'verifierChecklist', 'approvalGateTaskId', 'columnId', 'reviewStatus', 'labels', 'agentStatus']
  if (user.role !== 'admin' && isApprovalGatedTask && approvalGateFields.some((field) => body[field] !== undefined)) {
    return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }
  if (body.approvalStatus !== undefined && user.role !== 'admin') {
    return apiError('Only an admin approver can change approvalStatus on project tasks', 403)
  }
  if (body.approvalStatus !== undefined && body.approvalStatus !== null && !isApprovalGatedTask) {
    return apiError('approvalStatus can only be changed on approval-gated tasks', 400)
  }
  const updates = buildProjectTaskUpdateData(body)
  if (!updates.ok) return apiError(updates.error, updates.status ?? 400)
  const updateValue = applyAgentColumnMoveState(existing, updates.value, body)
  const projectOrgId = access.doc.data()?.orgId as string | undefined

  if (body.contextRefs !== undefined) {
    const contextRefs = await resolveContextReferences(
      sanitizeContextReferenceSeeds(body.contextRefs),
      user,
      projectOrgId,
    )
    updateValue.contextRefs = contextRefs
    const nextAgentInput = agentInputWithContextRefs(updateValue.agentInput ?? existing.agentInput, contextRefs)
    if (nextAgentInput) updateValue.agentInput = nextAgentInput
  }

  // Sentinel swap — the payload builder is pure JSON and can't emit FieldValue.serverTimestamp() itself.
  if (updateValue.agentHeartbeatAt === '__server_timestamp__') {
    updateValue.agentHeartbeatAt = FieldValue.serverTimestamp()
  }

  await ref.update({ ...updateValue, updatedAt: FieldValue.serverTimestamp() })

  if (projectOrgId) {
    logActivity({
      orgId: projectOrgId,
      type: 'task_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated task',
      entityId: taskId,
      entityType: 'task',
      entityTitle: (updateValue.title as string | undefined) ?? undefined,
    }).catch(() => {})
  }

  // Notify reporter when agent marks task done
  const agentJustDone = updateValue.agentStatus === 'done' && existing.agentStatus !== 'done'
  if (agentJustDone && projectOrgId) {
    const reporterId = typeof existing.reporterId === 'string' ? existing.reporterId : typeof existing.createdBy === 'string' ? existing.createdBy : null
    const agentId = typeof updateValue.assigneeAgentId === 'string' ? updateValue.assigneeAgentId : typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : 'agent'
    const taskTitle = String(existing.title ?? 'Task')
    if (reporterId && reporterId !== user.uid) {
      adminDb.collection('notifications').add({
        orgId: projectOrgId,
        userId: reporterId,
        agentId: null,
        type: 'task.agent_done',
        title: `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} finished a task`,
        body: taskTitle,
        link: await adminProjectTaskLink({ db: adminDb, orgId: projectOrgId, projectId, taskId }),
        data: { projectId, taskId },
        status: 'unread',
        priority: notificationPriority(existing.priority),
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
    }
  }

  const agentJustNeedsInput = (updateValue.agentStatus === 'awaiting-input' || updateValue.agentStatus === 'blocked')
    && updateValue.agentStatus !== existing.agentStatus
  if (agentJustNeedsInput && projectOrgId) {
    const reporterId = typeof existing.reporterId === 'string' ? existing.reporterId : typeof existing.createdBy === 'string' ? existing.createdBy : null
    const agentId = typeof updateValue.assigneeAgentId === 'string' ? updateValue.assigneeAgentId : typeof existing.assigneeAgentId === 'string' ? existing.assigneeAgentId : 'agent'
    const nextTask = { ...existing, ...updateValue, id: taskId }
    const recovery = buildBlockedTaskRecovery(nextTask)
    const link = await adminProjectTaskLink({ db: adminDb, orgId: projectOrgId, projectId, taskId })
    if (reporterId && reporterId !== user.uid) {
      adminDb.collection('notifications').add({
        orgId: projectOrgId,
        userId: reporterId,
        agentId,
        type: 'task.agent_needs_input',
        title: `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} needs Peet to continue`,
        body: `Exact blocker: ${recovery.blockingReason}. Proof needed: ${recovery.requiredEvidence}. Message for agent: ${recovery.messageForAgent}`,
        link,
        data: {
          projectId,
          taskId,
          taskTitle: String(existing.title ?? 'Task'),
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

  const previousAssignees = new Set(Array.isArray(existing.assigneeIds) ? existing.assigneeIds : existing.assigneeId ? [existing.assigneeId] : [])
  const nextAssignees = Array.isArray(updates.value.assigneeIds)
    ? updates.value.assigneeIds.filter((id): id is string => typeof id === 'string')
    : updates.value.assigneeId
      ? [String(updates.value.assigneeId)]
      : []
  const newAssignees = nextAssignees.filter(id => !previousAssignees.has(id) && id !== user.uid)

  if (newAssignees.length > 0) {
    const projectDoc = await adminDb.collection('projects').doc(projectId).get()
    const orgId = projectDoc.data()?.orgId
    if (typeof orgId === 'string') {
      const title = String(updates.value.title ?? existing.title ?? 'Task')
      for (const userId of newAssignees) {
        adminDb.collection('notifications').add({
          orgId,
          userId,
          agentId: null,
          type: 'task.assigned',
          title: 'Task assigned to you',
          body: title,
          link: await adminProjectTaskLink({ db: adminDb, orgId, projectId, taskId }),
          data: { projectId, taskId },
          status: 'unread',
          priority: notificationPriority(updates.value.priority ?? existing.priority),
          snoozedUntil: null,
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        }).catch(() => {})
      }
    }
  }

  return apiSuccess({ id: taskId })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  await adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId).delete()

  const deleteOrgId = access.doc.data()?.orgId as string | undefined
  if (deleteOrgId) {
    logActivity({
      orgId: deleteOrgId,
      type: 'task_deleted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Deleted task',
      entityId: taskId,
      entityType: 'task',
    }).catch(() => {})
  }

  return apiSuccess({ deleted: true })
})
