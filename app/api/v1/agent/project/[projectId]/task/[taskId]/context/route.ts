import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

function compactTask(id: string, data: Record<string, unknown>) {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    orgId: typeof data.orgId === 'string' ? data.orgId : '',
    projectId: typeof data.projectId === 'string' ? data.projectId : '',
    status: data.status ?? data.columnId ?? '',
    columnId: data.columnId ?? '',
    agentStatus: data.agentStatus ?? null,
    assigneeAgentId: data.assigneeAgentId ?? null,
    agentInput: data.agentInput ?? null,
    agentOutput: data.agentOutput ?? null,
    dependsOn: Array.isArray(data.dependsOn) ? data.dependsOn : [],
    approvalGateTaskId: data.approvalGateTaskId ?? null,
    approvalGate: data.approvalGate ?? null,
    approvalStatus: data.approvalStatus ?? null,
    reviewerAgentId: data.reviewerAgentId ?? null,
    reviewStatus: data.reviewStatus ?? null,
    riskLevel: data.riskLevel ?? null,
    requiredCapability: data.requiredCapability ?? null,
    sourceDocumentId: data.sourceDocumentId ?? null,
    sourceDocumentSectionId: data.sourceDocumentSectionId ?? null,
    sourceSpecVersion: data.sourceSpecVersion ?? null,
    sourceResearchItemId: data.sourceResearchItemId ?? null,
    expectedArtifacts: Array.isArray(data.expectedArtifacts) ? data.expectedArtifacts : [],
    verifierChecklist: Array.isArray(data.verifierChecklist) ? data.verifierChecklist : [],
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    chatDecisionExcerpt: typeof data.chatDecisionExcerpt === 'string' ? data.chatDecisionExcerpt : '',
  }
}

/**
 * Minimal, task-scoped handoff. Unlike the broad project endpoint it never
 * returns unrelated tasks, documents, or parent conversation history.
 */
export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { projectId, taskId } = await (ctx as RouteContext).params
  const explicitOrgId = req.headers.get('x-org-id')?.trim() || ''
  const isAgentActor = user.role === 'ai' || user.authKind === 'user_delegation'
  if (isAgentActor && !explicitOrgId) return apiError('X-Org-Id is required for agent task context', 400)
  if (isAgentActor && user.orgId && explicitOrgId !== user.orgId) return apiError('Agent organisation scope does not match X-Org-Id', 403)
  const orgId = explicitOrgId || user.activeOrgId || user.orgId || ''
  if (!orgId) return apiError('Active organisation is required for agent task context', 400)

  const scopedUser = { ...user, orgId, activeOrgId: orgId, orgIds: [orgId], allowedOrgIds: [orgId] }
  const access = await getProjectForUser(projectId, scopedUser, orgId)
  if (!access.ok) return apiError(access.error, access.status)

  const taskDoc = await access.doc.collection('tasks').doc(taskId).get()
  if (!taskDoc.exists) return apiError('Task not found', 404)
  const taskData = taskDoc.data() as Record<string, unknown>
  const taskOrgId = typeof taskData.orgId === 'string' ? taskData.orgId : ''
  if (taskOrgId && taskOrgId !== orgId && !access.projectAccess?.canViewInternal) return apiError('Task is outside the active organisation scope', 403)

  const dependencyIds = [...new Set([
    ...(Array.isArray(taskData.dependsOn) ? taskData.dependsOn.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []),
    ...(typeof taskData.approvalGateTaskId === 'string' && taskData.approvalGateTaskId ? [taskData.approvalGateTaskId] : []),
  ])]
  const dependencies = await Promise.all(dependencyIds.map(async (dependencyId) => {
    const doc = await access.doc.collection('tasks').doc(dependencyId).get()
    if (!doc.exists) return null
    const data = doc.data() as Record<string, unknown>
    return {
      id: doc.id,
      title: typeof data.title === 'string' ? data.title : '',
      agentStatus: data.agentStatus ?? null,
      approvalStatus: data.approvalStatus ?? null,
      reviewStatus: data.reviewStatus ?? null,
      output: data.agentOutput ?? null,
      completionEvidence: data.completionEvidence ?? null,
    }
  }))

  const commentsSnapshot = await taskDoc.ref.collection('comments').orderBy('createdAt', 'desc').limit(8).get()
  const comments = commentsSnapshot.docs.reverse().map((doc) => {
    const data = doc.data()
    return { id: doc.id, text: data.text ?? '', userName: data.userName ?? '', userRole: data.userRole ?? '', createdAt: data.createdAt ?? null }
  })

  const projectData = access.doc.data() ?? {}
  return apiSuccess({
    project: { id: projectId, name: projectData.name ?? '', status: projectData.status ?? '', orgId: projectData.orgId ?? '' },
    task: compactTask(taskDoc.id, taskData),
    dependencies: dependencies.filter(Boolean),
    comments,
  })
})
