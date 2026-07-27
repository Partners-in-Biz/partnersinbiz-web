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
import { isProjectTaskPlanningMutation, planningMutationBlocker } from '@/lib/projects/planningDiscovery'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function projectRequestOrgScope(req: NextRequest, user: Parameters<typeof getProjectForUser>[1]) {
  const explicitOrgId = req.headers.get('x-org-id')?.trim() || ''
  const isAgentActor = user.role === 'ai' || user.authKind === 'user_delegation'
  if (isAgentActor && !explicitOrgId) {
    return { ok: false as const, response: apiError('X-Org-Id is required for agent project task access', 400) }
  }
  if (isAgentActor && user.orgId && explicitOrgId !== user.orgId) {
    return { ok: false as const, response: apiError('Agent organisation scope does not match X-Org-Id', 403) }
  }
  return { ok: true as const, orgId: explicitOrgId || undefined }
}

function taskIsVisible(
  taskId: string,
  task: Record<string, unknown>,
  access: Extract<Awaited<ReturnType<typeof getProjectForUser>>, { ok: true }>,
  user: Parameters<typeof getProjectForUser>[1],
): boolean {
  return filterProjectItemsForAccess([{ id: taskId, ...task }], {
    projectAccess: access.projectAccess,
    user,
  }).length === 1
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

function hasApprovalGateLabel(labels: string[]): boolean {
  return labels.some((label) => /approval-gate|approval-required|client-approval|required-approval/.test(label))
}

function bodySetsApprovalGateLabel(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return hasApprovalGateLabel(value.filter((label): label is string => typeof label === 'string').map((label) => label.toLowerCase()))
}

function isApprovalGateRecord(data: Record<string, unknown>, nextBody: Record<string, unknown> = {}): boolean {
  const labels = Array.isArray(data.labels) ? data.labels.map((label) => String(label).toLowerCase()) : []
  const existingGate = typeof data.approvalGate === 'string' && data.approvalGate && data.approvalGate !== 'none'
  const nextGate = typeof nextBody.approvalGate === 'string' && nextBody.approvalGate && nextBody.approvalGate !== 'none'
  const existingApprovalStatus = typeof data.approvalStatus === 'string' && data.approvalStatus.trim().length > 0
  return hasApprovalGateLabel(labels) || bodySetsApprovalGateLabel(nextBody.labels) || Boolean(existingApprovalStatus || existingGate || nextGate)
}

async function approvalGateTaskApproved(projectId: string, approvalGateTaskId: string): Promise<boolean> {
  const gateDoc = await adminDb.collection('projects').doc(projectId).collection('tasks').doc(approvalGateTaskId).get()
  if (!gateDoc.exists) return false
  return gateDoc.data()?.approvalStatus === 'approved'
}

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to update tasks', 403)
  }
  const planningSensitive = isProjectTaskPlanningMutation(body)
  if (planningSensitive) {
    const planningBlocker = planningMutationBlocker(access.doc.data() ?? {})
    if (planningBlocker) return apiError(planningBlocker.message, 409, planningBlocker)
  }

  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const existing = doc.data() ?? {}
  if (!taskIsVisible(taskId, existing, access, user)) return apiError('Task not found', 404)
  const labels = Array.isArray(existing.labels) ? existing.labels.map((label) => String(label).toLowerCase()) : []
  const existingGate = typeof existing.approvalGate === 'string' && existing.approvalGate && existing.approvalGate !== 'none'
  const nextGate = typeof body.approvalGate === 'string' && body.approvalGate && body.approvalGate !== 'none'
  const existingApprovalStatus = typeof existing.approvalStatus === 'string' && existing.approvalStatus.trim().length > 0
  const existingApprovalGateTaskId = typeof existing.approvalGateTaskId === 'string' && existing.approvalGateTaskId.trim().length > 0
  const nextApprovalGateLabel = bodySetsApprovalGateLabel(body.labels)
  const isApprovalGateCard = hasApprovalGateLabel(labels) || nextApprovalGateLabel || existingApprovalStatus || existingGate || nextGate
  const isApprovalGatedTask = isApprovalGateCard || existingApprovalGateTaskId
  const approvalMetadataFields = ['approvalGate', 'requiredCapability', 'riskLevel', 'expectedArtifacts', 'verifierChecklist', 'approvalGateTaskId']
  const approvalExecutionFields = ['columnId', 'reviewStatus', 'labels', 'agentStatus', 'assigneeAgentId', 'agentOutput', 'agentConversationId', 'agentHeartbeatAt', 'agentReleaseAt', 'agentReleaseStatus', 'agentReleasedAt']
  if (body.approvalStatus !== undefined && user.role !== 'admin') {
    return apiError('Only an admin approver can change approvalStatus on project tasks', 403)
  }
  if (user.role !== 'admin' && approvalMetadataFields.some((field) => body[field] !== undefined)) {
    return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }
  if (body.approvalStatus !== undefined && body.approvalStatus !== null && !isApprovalGatedTask) {
    return apiError('approvalStatus can only be changed on approval-gated tasks', 400)
  }
  const updates = buildProjectTaskUpdateData(body)
  if (!updates.ok) return apiError(updates.error, updates.status ?? 400)
  const updateValue = applyAgentColumnMoveState(existing, updates.value, body)
  const touchesApprovalExecutionState = approvalExecutionFields.some((field) => updateValue[field] !== undefined)
  if (user.role !== 'admin' && isApprovalGateCard && touchesApprovalExecutionState) {
    return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }
  if (user.role !== 'admin' && existingApprovalGateTaskId && touchesApprovalExecutionState) {
    const approved = await approvalGateTaskApproved(projectId, String(existing.approvalGateTaskId))
    if (!approved) return apiError('Only an admin approver can change approval-gate metadata on project tasks', 403)
  }
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

  const projectRef = adminDb.collection('projects').doc(projectId)
  const mutation = await adminDb.runTransaction(async (tx) => {
    if (planningSensitive) {
      const liveProject = await tx.get(projectRef)
      if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
      const planningBlocker = planningMutationBlocker(liveProject.data() ?? {})
      if (planningBlocker) {
        return { ok: false as const, status: 409, error: planningBlocker.message, details: planningBlocker }
      }
    }
    const liveTask = await tx.get(ref)
    if (!liveTask.exists) return { ok: false as const, status: 404, error: 'Task not found' }
    tx.update(ref, { ...updateValue, updatedAt: FieldValue.serverTimestamp() })
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)

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
  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to delete tasks', 403)
  }
  const planningBlocker = planningMutationBlocker(access.doc.data() ?? {})
  if (planningBlocker) return apiError(planningBlocker.message, 409, planningBlocker)

  const ref = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)

  const existing = doc.data() ?? {}
  if (!taskIsVisible(taskId, existing, access, user)) return apiError('Task not found', 404)
  const hasApprovalGateTaskId = typeof existing.approvalGateTaskId === 'string' && existing.approvalGateTaskId.trim().length > 0
  if (user.role !== 'admin' && (isApprovalGateRecord(existing) || hasApprovalGateTaskId)) {
    return apiError('Only an admin approver can delete approval-gated project tasks', 403)
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  const mutation = await adminDb.runTransaction(async (tx) => {
    const liveProject = await tx.get(projectRef)
    const liveTask = await tx.get(ref)
    if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    if (!liveTask.exists) return { ok: false as const, status: 404, error: 'Task not found' }
    const planningBlocker = planningMutationBlocker(liveProject.data() ?? {})
    if (planningBlocker) {
      return { ok: false as const, status: 409, error: planningBlocker.message, details: planningBlocker }
    }
    tx.delete(ref)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)

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
