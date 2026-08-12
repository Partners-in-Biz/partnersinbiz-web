import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { evaluateUnblockReadiness, type DependencyStatus } from '@/lib/projects/blockerRecovery'
import { upsertProjectTaskReadModel } from '@/lib/projects/taskReadModelStore'
import { planningMutationBlocker } from '@/lib/projects/planningDiscovery'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

function actorRole(role: string): 'admin' | 'client' | 'ai' {
  if (role === 'admin') return 'admin'
  if (role === 'ai') return 'ai'
  return 'client'
}

function isAuthorisedToUnblock(role: string): boolean {
  return role === 'admin' || role === 'client'
}

function isApprovalGateTask(task: Record<string, unknown>): boolean {
  const labels = Array.isArray(task.labels) ? task.labels.filter((label): label is string => typeof label === 'string') : []
  const approvalGate = typeof task.approvalGate === 'string' && task.approvalGate.trim() && task.approvalGate !== 'none'
  return Boolean(
    approvalGate
    || typeof task.approvalStatus === 'string'
    || labels.some((label) => /^(approval-gate|approval-required|client-approval|required-approval)(:.*)?$/i.test(String(label || '').trim())),
  )
}

function taskLabel(task: Record<string, unknown>, fallback: string): string {
  return typeof task.title === 'string' && task.title.trim() ? task.title.trim() : fallback
}

async function loadRelatedTasks(projectId: string, ids: string[]): Promise<DependencyStatus[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return []
  const refs = uniqueIds.map((id) => adminDb.collection('projects').doc(projectId).collection('tasks').doc(id))
  const docs = await adminDb.getAll(...refs)
  return docs.filter((doc) => doc.exists).map((doc) => {
    const data = doc.data() ?? {}
    return {
      id: doc.id,
      title: typeof data.title === 'string' ? data.title : doc.id,
      columnId: typeof data.columnId === 'string' ? data.columnId : null,
      agentStatus: typeof data.agentStatus === 'string' ? data.agentStatus : null,
      reviewStatus: typeof data.reviewStatus === 'string' ? data.reviewStatus : null,
      approvalStatus: typeof data.approvalStatus === 'string' ? data.approvalStatus : null,
      approvalGate: typeof data.approvalGate === 'string' ? data.approvalGate : null,
      labels: Array.isArray(data.labels) ? data.labels.filter((label): label is string => typeof label === 'string') : [],
    }
  })
}

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write', item: taskId })
  if (!access.ok) return apiError(access.error, access.status)
  if (!isAuthorisedToUnblock(user.role)) return apiError('Only an authorised user can unblock a waiting task', 403)
  const planningBlocker = planningMutationBlocker((access.doc.data() ?? {}) as Record<string, unknown>)
  if (planningBlocker) return apiError(planningBlocker.message, 409, planningBlocker)

  const taskRef = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const taskDoc = await taskRef.get()
  if (!taskDoc.exists || filterProjectItemsForAccess([{ id: taskId, ...(taskDoc.data() ?? {}) }], {
    projectAccess: access.projectAccess,
    user,
  }).length !== 1) return apiError('Task not found', 404)

  const task = taskDoc.data() ?? {}
  const isBlocked = task.columnId === 'blocked' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input'
  if (!isBlocked) return apiError('Task is not blocked or awaiting input', 400)
  if (isApprovalGateTask(task) && task.approvalStatus !== 'approved') {
    return apiError('Cannot unblock yet', 409, { reasons: [`Approval gate “${taskLabel(task, taskId)}” is not approved yet.`] })
  }

  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : []
  const approvalGateTaskId = typeof task.approvalGateTaskId === 'string' && task.approvalGateTaskId.trim() ? task.approvalGateTaskId.trim() : null
  const relatedTasks = await loadRelatedTasks(projectId, [...dependsOn, ...(approvalGateTaskId ? [approvalGateTaskId] : [])])
  const visibleRelatedTasks = filterProjectItemsForAccess(relatedTasks, {
    projectAccess: access.projectAccess,
    user,
  })
  // Never leak the title, status, or existence details of an item outside a
  // targeted external grant through a dependency/readiness response.
  if (visibleRelatedTasks.length !== relatedTasks.length) {
    return apiError('Cannot unblock yet', 409, { reasons: ['A required dependency or approval gate is not available for this share.'] })
  }
  const readiness = evaluateUnblockReadiness({ dependsOn, approvalGateTaskId }, visibleRelatedTasks)
  if (!readiness.ready) {
    return apiError('Cannot unblock yet', 409, { reasons: readiness.reasons })
  }

  const hasAgent = typeof task.assigneeAgentId === 'string' && task.assigneeAgentId.trim().length > 0
  const labels = Array.isArray(task.labels)
    ? task.labels.filter((label) => typeof label === 'string' && !/^blocked$/i.test(label) && !/^awaiting-input$/i.test(label))
    : []
  const update: Record<string, unknown> = {
    columnId: 'todo',
    labels,
    reviewStatus: hasAgent ? 'changes-requested' : null,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (hasAgent) {
    // An authorised requeue begins a brand-new attempt. Never let a prior 502
    // retry, dispatch failure, or canary completion record bleed into it.
    // Increment agentRetryCount instead of nulling it: watcher dispatch keys are
    // derived from that counter, and reusing attempt 0 after a payload change
    // freezes the card on Hermes HTTP 409 idempotency_key_conflict.
    const priorAttempt = Number.isFinite(Number(task.agentRetryCount))
      ? Math.max(0, Math.trunc(Number(task.agentRetryCount)))
      : 0
    update.agentStatus = 'pending'
    update.agentOutput = null
    update.agentConversationId = null
    update.agentHeartbeatAt = null
    update.agentRetryCount = priorAttempt + 1
    update.agentRetryAt = null
    update.agentDispatchKey = null
    update.agentDispatchFailure = null
    update.completionEvidence = null
    update.completionIntegrityFailureReasons = null
    update.completionVerification = null
    update.reviewRetryCount = null
    update.reviewRetryAt = null
  } else {
    update.agentStatus = null
  }

  await taskRef.update(update)
  await upsertProjectTaskReadModel(projectId, taskId, { ...task, ...update }).catch(() => {})

  const userRole = actorRole(user.role)
  const userName = user.uid
  const auditText = [
    '✅ Unblocked by authorised user.',
    hasAgent ? 'Dependencies/approval gates are satisfied; task requeued for the assigned agent.' : 'Dependencies/approval gates are satisfied; blocked state cleared.',
  ].join(' ')

  const commentRef = taskRef.collection('comments').doc()
  await commentRef.set({
    text: auditText,
    userId: user.uid,
    userName,
    userRole,
    createdAt: FieldValue.serverTimestamp(),
    agentPickedUp: false,
    agentPickedUpAt: null,
  })

  const orgId = access.doc.data()?.orgId as string | undefined
  if (orgId) {
    logActivity({
      orgId,
      type: 'task_updated',
      actorId: user.uid,
      actorName: userName,
      actorRole: userRole,
      description: 'Unblocked and requeued task',
      entityId: taskId,
      entityType: 'task',
      entityTitle: typeof task.title === 'string' ? task.title : undefined,
    }).catch(() => {})
  }

  return apiSuccess({ id: taskId, requeued: hasAgent, commentId: commentRef.id })
})
