/**
 * GET /api/v1/agent/project/[projectId] — returns full project context for an AI agent
 *
 * Returns:
 * {
 *   project: { name, status, description, brief, orgId },
 *   documents: [ { title, content, type } ],
 *   tasks: [ { id, orgId, projectId, title, description, priority, columnId, status, assigneeAgentId, agentStatus, agentInput, agentOutput, dependsOn, labels, reviewStatus, agentConversationId, agentHeartbeatAt, attachments } ],
 *   recentComments: [ ... ] // latest 10 comments across all tasks
 * }
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { applyAgentPermissionPolicies, loadAgentProjectPlan } from '@/lib/projects/agentSuiteProjection'
import { filterProjectItemsForAccess } from '@/lib/projects/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }
type RecentTaskComment = {
  taskId: string
  text: string
  userId: string
  userName: string
  createdAt?: unknown
}

function timestampMillis(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  const maybeTimestamp = value as { toMillis?: unknown }
  return typeof maybeTimestamp.toMillis === 'function' ? (maybeTimestamp.toMillis as () => number)() : 0
}

export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const explicitOrgId = req.headers.get('x-org-id')?.trim() || ''
  const isAgentActor = user.role === 'ai' || user.authKind === 'user_delegation'
  if (isAgentActor && !explicitOrgId) return apiError('X-Org-Id is required for agent project context', 400)
  if (isAgentActor && user.orgId && explicitOrgId !== user.orgId) {
    return apiError('Agent organisation scope does not match X-Org-Id', 403)
  }
  const requestedOrgId = explicitOrgId || user.activeOrgId || user.orgId || ''
  if (!requestedOrgId) return apiError('Active organisation is required for agent project context', 400)

  const scopedUser = {
    ...user,
    orgId: requestedOrgId,
    activeOrgId: requestedOrgId,
    orgIds: [requestedOrgId],
    allowedOrgIds: [requestedOrgId],
  }
  const access = await getProjectForUser(projectId, scopedUser, requestedOrgId)
  if (!access.ok) return apiError(access.error, access.status)
  const projectDoc = access.doc

  const projectData = projectDoc.data()
  const ownerOrgId = [projectData?.ownerOrgId, projectData?.sourceOrgId, projectData?.issuerOrgId, projectData?.orgId]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? ''
  const projectAccess = requestedOrgId !== ownerOrgId && access.projectAccess?.role === 'owner'
    ? { ...access.projectAccess, role: 'contributor' as const, canViewInternal: false }
    : access.projectAccess
  const project = {
    name: projectData?.name ?? '',
    status: projectData?.status ?? '',
    description: projectData?.description ?? '',
    brief: projectData?.brief ?? '',
    orgId: projectData?.orgId ?? '',
  }

  // Get documents
  const docsSnapshot = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('docs')
    .orderBy('createdAt', 'desc')
    .get()

  const documentRecords = docsSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as { id: string; title?: unknown; content?: unknown; type?: unknown } & Record<string, unknown>))

  // Get tasks
  const tasksSnapshot = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('tasks')
    .orderBy('order', 'asc')
    .get()

  const taskRecords = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  const plan = await loadAgentProjectPlan({
    projectId,
    activeOrgId: requestedOrgId,
    projectData: projectData ?? {},
    tasks: taskRecords,
    user: scopedUser,
    projectAccess,
  })
  const visibleDocumentRecords = filterProjectItemsForAccess(
    applyAgentPermissionPolicies(documentRecords, plan.permissions, 'document').filter((record) => {
      const allowedOrgIds = Array.isArray(record.allowedOrgIds)
        ? record.allowedOrgIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : []
      return allowedOrgIds.length === 0 || allowedOrgIds.includes(requestedOrgId)
    }),
    { projectAccess, user: scopedUser },
  )
  const documents = visibleDocumentRecords.map(data => ({
    id: data.id,
    title: typeof data.title === 'string' ? data.title : '',
    content: typeof data.content === 'string' ? data.content : '',
    type: typeof data.type === 'string' ? data.type : 'notes',
  }))
  const visibleTaskRecords = plan.tasks
  const visibleTaskIds = new Set(visibleTaskRecords.map((task) => task.id))

  const tasks = visibleTaskRecords.map(data => {
    return {
      id: data.id,
      orgId: data.orgId ?? project.orgId,
      projectId: data.projectId ?? projectId,
      title: data.title ?? '',
      description: data.description ?? '',
      priority: data.priority ?? 'medium',
      columnId: data.columnId ?? '',
      status: data.status ?? data.columnId ?? '',
      assigneeAgentId: data.assigneeAgentId ?? null,
      agentStatus: data.agentStatus ?? null,
      agentEffort: data.agentEffort ?? null,
      agentModel: data.agentModel ?? null,
      agentInput: data.agentInput ?? null,
      agentOutput: data.agentOutput ?? null,
      dependsOn: Array.isArray(data.dependsOn) ? data.dependsOn : [],
      labels: Array.isArray(data.labels) ? data.labels : [],
      reviewerIds: Array.isArray(data.reviewerIds) ? data.reviewerIds : [],
      reviewerAgentId: data.reviewerAgentId ?? null,
      reviewStatus: data.reviewStatus ?? null,
      approvalStatus: data.approvalStatus ?? null,
      riskLevel: data.riskLevel ?? null,
      approvalGate: data.approvalGate ?? null,
      requiredCapability: data.requiredCapability ?? null,
      requestedByAgentId: data.requestedByAgentId ?? null,
      approvalGateTaskId: data.approvalGateTaskId ?? null,
      sourceDocumentId: data.sourceDocumentId ?? null,
      sourceDocumentSectionId: data.sourceDocumentSectionId ?? null,
      sourceSpecVersion: data.sourceSpecVersion ?? null,
      sourceResearchItemId: data.sourceResearchItemId ?? null,
      expectedArtifacts: Array.isArray(data.expectedArtifacts) ? data.expectedArtifacts : [],
      verifierChecklist: Array.isArray(data.verifierChecklist) ? data.verifierChecklist : [],
      agentConversationId: data.agentConversationId ?? null,
      agentHeartbeatAt: data.agentHeartbeatAt ?? null,
      attachments: data.attachments ?? [],
    }
  })

  // Get recent comments (latest 10 across all tasks)
  const recentComments: RecentTaskComment[] = []
  for (const taskDoc of tasksSnapshot.docs.filter((doc) => visibleTaskIds.has(doc.id))) {
    const commentsSnapshot = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('tasks')
      .doc(taskDoc.id)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get()

    commentsSnapshot.docs.forEach(commentDoc => {
      const data = commentDoc.data()
      recentComments.push({
        taskId: taskDoc.id,
        text: data.text ?? '',
        userId: data.userId ?? '',
        userName: data.userName ?? '',
        createdAt: data.createdAt,
      })
    })
  }

  // Sort and take top 10
  recentComments.sort((a, b) => {
    const aTime = timestampMillis(a.createdAt)
    const bTime = timestampMillis(b.createdAt)
    return bTime - aTime
  })
  const topComments = recentComments.slice(0, 10)

  return apiSuccess({
    project,
    documents,
    tasks,
    plan,
    recentComments: topComments,
  })
})
