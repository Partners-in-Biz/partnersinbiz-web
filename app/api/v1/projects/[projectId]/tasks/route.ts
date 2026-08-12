import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { actorFrom } from '@/lib/api/actor'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { getProjectForUser } from '@/lib/projects/access'
import {
  buildProjectTaskCreateData,
  notificationPriority,
  taskOrderMillis,
} from '@/lib/projects/taskPayload'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds, type ContextReference } from '@/lib/context-references/types'
import { getConversation } from '@/lib/conversations/conversations'
import { applyTaskLlmCredentialResolution } from '@/lib/projects/apply-task-llm'
import { applyOrgChartToAssignment, applyOrgDefaultsToTaskFields } from '@/lib/agent-org/taskHooks'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'
import { getProjectTaskReadModel, seedProjectTaskReadModel, upsertProjectTaskReadModel } from '@/lib/projects/taskReadModelStore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function applyPlanningMutation(
  tx: FirebaseFirestore.Transaction,
  projectRef: FirebaseFirestore.DocumentReference,
  projectId: string,
  project: Record<string, unknown>,
  actorUid: string,
  reason: string,
) {
  const transition = planningContextMutationTransition(project, {
    uid: actorUid,
    now: new Date().toISOString(),
    reason,
    reopenWhenReady: reason !== 'project_task.created',
  })
  if (transition.state) {
    tx.update(projectRef, { planningDiscovery: transition.state, updatedAt: FieldValue.serverTimestamp() })
  }
  if (transition.event) {
    tx.set(projectRef.collection('planningDiscoveryEvents').doc(), {
      ...transition.event,
      projectId,
      orgId: project.orgId ?? null,
      schemaVersion: 1,
      reason,
    })
  }
  return transition
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function authoritativeProjectOrgId(project: Record<string, unknown>): string {
  return cleanString(project.orgId) || cleanString(project.ownerOrgId) || cleanString(project.sourceOrgId) || cleanString(project.issuerOrgId)
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

async function validateChatOrigin(input: {
  projectId: string
  orgId?: string
  chatOrigin: unknown
}) {
  if (!isRecord(input.chatOrigin)) return { ok: true as const, duplicateTaskId: null, runtimeTargetId: null }
  const conversationId = String(input.chatOrigin.conversationId ?? '')
  const bundleId = String(input.chatOrigin.bundleId ?? '')
  const sequence = Number(input.chatOrigin.sequence)
  const conversation = await getConversation(conversationId)
  const projectIsAttached = conversation?.scope === 'project' && conversation.scopeRefId === input.projectId
    || conversation?.contextRefs?.some((ref) => ref.type === 'project' && ref.id === input.projectId) === true
  if (!conversation || conversation.orgId !== input.orgId || !projectIsAttached) {
    return { ok: false as const, error: 'chatOrigin must reference a conversation in the same organisation with this project attached' }
  }

  const duplicates = await adminDb.collection('projects').doc(input.projectId).collection('tasks')
    .where('chatOrigin.bundleId', '==', bundleId)
    .where('chatOrigin.sequence', '==', sequence)
    .limit(1)
    .get()
  return {
    ok: true as const,
    duplicateTaskId: duplicates.empty ? null : duplicates.docs[0]?.id ?? null,
    runtimeTargetId: conversation.workspaceContext?.runtimeTarget?.trim() || null,
  }
}

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
  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId)
  if (!access.ok) return apiError(access.error, access.status)

  const boardView = req.nextUrl.searchParams.get('view') === 'board'
  const readModel = boardView ? await getProjectTaskReadModel(projectId) : null
  const tasks = (readModel?.tasks ?? await (async () => {
    const snapshot = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('tasks')
      .get()
    const fullTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    if (boardView) await seedProjectTaskReadModel(projectId, fullTasks)
    return fullTasks
  })())
    .sort((a, b) => taskOrderMillis((a as Record<string, unknown>).order) - taskOrderMillis((b as Record<string, unknown>).order))
  return apiSuccess(filterProjectItemsForAccess(tasks, { projectAccess: access.projectAccess, user }))
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const scope = projectRequestOrgScope(req, user)
  if (!scope.ok) return scope.response
  const access = await getProjectForUser(projectId, user, scope.orgId)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to create tasks', 403)
  }
  const project = access.doc.data() ?? {}

  const orgId = authoritativeProjectOrgId(project)
  if (!orgId) return apiError('Project organisation is required to create tasks', 400)
  const taskBody = { ...body }
  delete taskBody.orgId
  const taskData = buildProjectTaskCreateData(taskBody, projectId, orgId)
  if (!taskData.ok) return apiError(taskData.error, taskData.status ?? 400)
  taskData.value.orgId = orgId
  const chatOriginValidation = await validateChatOrigin({
    projectId,
    orgId,
    chatOrigin: taskData.value.chatOrigin,
  })
  if (!chatOriginValidation.ok) return apiError(chatOriginValidation.error, 400)
  if (chatOriginValidation.duplicateTaskId) {
    return apiSuccess({ id: chatOriginValidation.duplicateTaskId, deduplicated: true })
  }
  if (chatOriginValidation.runtimeTargetId) {
    taskData.value.agentRuntimeTargetId = chatOriginValidation.runtimeTargetId
  }
  const contextRefs = await resolveContextReferences(
    sanitizeContextReferenceSeeds(body.contextRefs),
    user,
    orgId,
  )
  if (contextRefs.length > 0) {
    taskData.value.contextRefs = contextRefs
    attachContextRefsToAgentInput(taskData.value, contextRefs)
  }

  // Org-chart gate: relationship enforcement + node defaults for agent assignees.
  const assigneeForGate = typeof taskData.value.assigneeAgentId === 'string' ? taskData.value.assigneeAgentId : null
  if (assigneeForGate) {
    const orgGate = await applyOrgChartToAssignment({
      orgId,
      user,
      assigneeAgentId: assigneeForGate,
    })
    if (!orgGate.ok) return apiError(orgGate.error ?? 'Org chart does not permit this assignment', orgGate.status ?? 403)
    if (orgGate.defaults) {
      applyOrgDefaultsToTaskFields(taskData.value, orgGate.defaults)
    }
  }

  await applyTaskLlmCredentialResolution({
    orgId,
    ownerUid: user.uid,
    user,
    taskFields: taskData.value,
    syncPersonal: true,
    runtimeTargetId: chatOriginValidation.runtimeTargetId,
  })

  const created = actorFrom(user)
  const doc: Record<string, unknown> = {
    ...taskData.value,
    reporterId: created.createdBy,
    ...created,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: created.createdBy,
    ...(created.createdByAgentId ? { updatedByAgentId: created.createdByAgentId } : {}),
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  const ref = projectRef.collection('tasks').doc()
  const mutation = await adminDb.runTransaction(async (tx) => {
    const liveProject = await tx.get(projectRef)
    if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    const project = (liveProject.data() ?? {}) as Record<string, unknown>
    const planning = applyPlanningMutation(tx, projectRef, projectId, project, user.uid, 'project_task.created')
    if (!planning.allowed) {
      return { ok: false as const, status: 409, error: planning.blocker.message, details: planning.blocker }
    }
    tx.set(ref, doc)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)

  await upsertProjectTaskReadModel(projectId, ref.id, doc).catch(() => {})

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
        link: `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(ref.id)}`,
        data: { projectId, taskId: ref.id, taskTitle: String(doc.title) },
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
