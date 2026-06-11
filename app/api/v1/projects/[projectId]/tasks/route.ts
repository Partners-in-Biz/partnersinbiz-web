import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { getProjectForUser } from '@/lib/projects/access'
import {
  buildProjectTaskCreateData,
  notificationPriority,
  taskOrderMillis,
} from '@/lib/projects/taskPayload'
import { filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds, type ContextReference } from '@/lib/context-references/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function attachContextRefsToAgentInput(value: Record<string, unknown>, contextRefs: ContextReference[]) {
  if (contextRefs.length === 0) return
  const agentInput = value.agentInput
  if (!agentInput || typeof agentInput !== 'object' || Array.isArray(agentInput)) return
  const input = agentInput as Record<string, unknown>
  const existingContext = input.context && typeof input.context === 'object' && !Array.isArray(input.context)
    ? input.context as Record<string, unknown>
    : {}
  value.agentInput = {
    ...input,
    context: {
      ...existingContext,
      contextRefs,
    },
  }
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const snapshot = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('tasks')
    .get()

  const tasks = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => taskOrderMillis((a as Record<string, unknown>).order) - taskOrderMillis((b as Record<string, unknown>).order))
  return apiSuccess(filterProjectItemsForAccess(tasks, { projectAccess: access.projectAccess, user }))
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  const project = access.doc.data() ?? {}

  const taskData = buildProjectTaskCreateData(body, projectId, typeof project.orgId === 'string' ? project.orgId : undefined)
  if (!taskData.ok) return apiError(taskData.error, taskData.status ?? 400)
  const orgId = typeof taskData.value.orgId === 'string' ? taskData.value.orgId : typeof project.orgId === 'string' ? project.orgId : undefined
  const contextRefs = await resolveContextReferences(
    sanitizeContextReferenceSeeds(body.contextRefs),
    user,
    orgId,
  )
  if (contextRefs.length > 0) {
    taskData.value.contextRefs = contextRefs
    attachContextRefsToAgentInput(taskData.value, contextRefs)
  }

  const doc: Record<string, unknown> = {
    ...taskData.value,
    reporterId: user.uid,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const ref = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('tasks')
    .add(doc)

  if (orgId) {
    const actorName = user.uid === 'ai-agent'
      ? 'AI Agent'
      : (await adminDb.collection('users').doc(user.uid).get()).data()?.displayName ?? user.uid

    logActivity({
      orgId,
      type: 'task_created',
      actorId: user.uid,
      actorName,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: `Created task: "${doc.title}"`,
      entityId: ref.id,
      entityType: 'task',
      entityTitle: String(doc.title),
    }).catch(() => {})

    const notifyUserIds = new Set<string>([
      ...(Array.isArray(doc.assigneeIds) ? doc.assigneeIds.filter((id): id is string => typeof id === 'string') : []),
      ...(Array.isArray(doc.mentionIds) ? doc.mentionIds.filter((id): id is string => typeof id === 'string') : []),
    ])
    for (const userId of notifyUserIds) {
      if (userId === user.uid) continue
      adminDb.collection('notifications').add({
        orgId,
        userId,
        agentId: null,
        type: 'task.assigned',
        title: 'Task assigned to you',
        body: String(doc.title),
        link: `/portal/projects/${projectId}?task=${ref.id}`,
        data: { projectId, taskId: ref.id },
        status: 'unread',
        priority: notificationPriority(doc.priority),
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
    }
  }

  return apiSuccess({ id: ref.id }, 201)
})
