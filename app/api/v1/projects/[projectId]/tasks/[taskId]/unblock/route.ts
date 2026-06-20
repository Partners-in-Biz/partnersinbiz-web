import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { evaluateUnblockReadiness, type DependencyStatus } from '@/lib/projects/blockerRecovery'
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
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  if (!isAuthorisedToUnblock(user.role)) return apiError('Only an authorised user can unblock a waiting task', 403)

  const taskRef = adminDb.collection('projects').doc(projectId).collection('tasks').doc(taskId)
  const taskDoc = await taskRef.get()
  if (!taskDoc.exists) return apiError('Task not found', 404)

  const task = taskDoc.data() ?? {}
  const isBlocked = task.columnId === 'blocked' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input'
  if (!isBlocked) return apiError('Task is not blocked or awaiting input', 400)

  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : []
  const approvalGateTaskId = typeof task.approvalGateTaskId === 'string' && task.approvalGateTaskId.trim() ? task.approvalGateTaskId.trim() : null
  const relatedTasks = await loadRelatedTasks(projectId, [...dependsOn, ...(approvalGateTaskId ? [approvalGateTaskId] : [])])
  const readiness = evaluateUnblockReadiness({ dependsOn, approvalGateTaskId }, relatedTasks)
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
    update.agentStatus = 'pending'
    update.agentConversationId = null
    update.agentHeartbeatAt = null
  } else {
    update.agentStatus = null
  }

  await taskRef.update(update)

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
