import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { getProjectForUser } from '@/lib/projects/access'
import { filterProjectItemsForAccess, type ProjectAccessContext } from '@/lib/projects/collaboration'
import { applyAgentPermissionPolicies } from '@/lib/projects/agentSuiteProjection'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; taskId: string }> }

const MAX_TASK_SPEC_CHARS = 8_000
const MAX_SUMMARY_CHARS = 2_000
const MAX_COMMENT_CHARS = 1_200

function compactText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text
}

function compactAgentInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const context = input.context && typeof input.context === 'object' && !Array.isArray(input.context)
    ? input.context as Record<string, unknown>
    : {}
  const allowedContext = [
    'sourceDocumentId', 'sourceDocumentSectionId', 'sourceSpecVersion', 'approvalGateTaskId',
    'sourceResearchItemId', 'riskLevel', 'requiredCapability', 'expectedArtifacts',
    'verifierChecklist', 'contextRefs',
  ].reduce<Record<string, unknown>>((out, key) => {
    if (context[key] !== undefined) out[key] = context[key]
    return out
  }, {})
  return {
    spec: compactText(input.spec, MAX_TASK_SPEC_CHARS),
    ...(Array.isArray(input.constraints)
      ? { constraints: input.constraints.filter((item): item is string => typeof item === 'string').slice(0, 20).map((item) => compactText(item, 300)) }
      : {}),
    ...(Object.keys(allowedContext).length > 0 ? { context: allowedContext } : {}),
  }
}

function compactAgentOutput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const output = value as Record<string, unknown>
  return {
    summary: compactText(output.summary, MAX_SUMMARY_CHARS),
    ...(Array.isArray(output.artifacts) ? { artifacts: output.artifacts.slice(0, 20) } : {}),
    ...(output.completedAt !== undefined ? { completedAt: output.completedAt } : {}),
  }
}

function ownerOrgId(project: Record<string, unknown>): string {
  for (const key of ['ownerOrgId', 'sourceOrgId', 'issuerOrgId', 'orgId']) {
    const value = project[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function agentAllowsOrg(user: ApiUser, orgId: string): boolean {
  if (!orgId) return false
  if (user.role === 'ai' && !user.orgId) return true
  if (user.orgId === orgId || user.activeOrgId === orgId) return true
  return (user.orgIds ?? []).includes(orgId)
}

function buildAgentScopedUser(user: ApiUser, requestedOrgId: string): ApiUser {
  const orgIds = Array.from(new Set([
    ...(user.orgIds ?? []),
    user.orgId,
    user.activeOrgId,
    requestedOrgId,
    PIB_PLATFORM_ORG_ID,
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))))
  return {
    ...user,
    orgId: requestedOrgId,
    activeOrgId: requestedOrgId,
    orgIds,
  }
}

async function resolveAgentProjectAccess(
  projectId: string,
  scopedUser: ApiUser,
  requestedOrgId: string,
) {
  let access = await getProjectForUser(projectId, scopedUser, requestedOrgId)
  if (access.ok) return access
  if (requestedOrgId !== PIB_PLATFORM_ORG_ID) {
    access = await getProjectForUser(projectId, scopedUser, PIB_PLATFORM_ORG_ID)
    if (access.ok) return access
  }
  return getProjectForUser(projectId, scopedUser)
}

function isVisibleTask(
  task: Record<string, unknown> & { id: string },
  policies: Array<Record<string, unknown> & { id: string }>,
  projectAccess: ProjectAccessContext | null | undefined,
  user: Parameters<typeof filterProjectItemsForAccess>[1]['user'],
): boolean {
  return filterProjectItemsForAccess(
    applyAgentPermissionPolicies([task], policies, 'task'),
    { projectAccess, user },
  ).length === 1
}

function isVisibleDocument(
  document: Record<string, unknown> & { id: string },
  policies: Array<Record<string, unknown> & { id: string }>,
  projectAccess: ProjectAccessContext | null | undefined,
  user: Parameters<typeof filterProjectItemsForAccess>[1]['user'],
): boolean {
  return filterProjectItemsForAccess(
    applyAgentPermissionPolicies([document], policies, 'document'),
    { projectAccess, user },
  ).length === 1
}

function compactTask(id: string, data: Record<string, unknown>) {
  return {
    id,
    title: compactText(data.title, 500),
    description: compactText(data.description, 4_000),
    orgId: typeof data.orgId === 'string' ? data.orgId : '',
    projectId: typeof data.projectId === 'string' ? data.projectId : '',
    status: data.status ?? data.columnId ?? '',
    columnId: data.columnId ?? '',
    agentStatus: data.agentStatus ?? null,
    assigneeAgentId: data.assigneeAgentId ?? null,
    agentInput: compactAgentInput(data.agentInput),
    agentOutput: compactAgentOutput(data.agentOutput),
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
    completionEvidence: data.completionEvidence ?? null,
    completionVerification: data.completionVerification ?? null,
    completionIntegrityFailureReasons: data.completionIntegrityFailureReasons ?? null,
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
  if (isAgentActor && explicitOrgId && !agentAllowsOrg(user, explicitOrgId)) {
    return apiError('Agent organisation scope does not match X-Org-Id', 403)
  }
  const orgId = explicitOrgId || user.activeOrgId || user.orgId || ''
  if (!orgId) return apiError('Active organisation is required for agent task context', 400)

  const scopedUser = buildAgentScopedUser(user, orgId)
  const access = await resolveAgentProjectAccess(projectId, scopedUser, orgId)
  if (!access.ok) return apiError(access.error, access.status)

  const projectRef = access.doc.ref
  const projectData = (access.doc.data() ?? {}) as Record<string, unknown>
  const projectAccess = orgId !== ownerOrgId(projectData) && access.projectAccess?.role === 'owner'
    ? { ...access.projectAccess, role: 'contributor' as const, canViewInternal: false }
    : access.projectAccess
  const permissionsSnapshot = await projectRef.collection('permissions').get()
  const policies = permissionsSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string })
    .filter((policy) => policy.deleted !== true && policy.status !== 'archived' && policy.status !== 'revoked')
  const taskDoc = await projectRef.collection('tasks').doc(taskId).get()
  if (!taskDoc.exists) return apiError('Task not found', 404)
  const taskData = taskDoc.data() as Record<string, unknown>
  if (typeof taskData.projectId === 'string' && taskData.projectId && taskData.projectId !== projectId) return apiError('Task not found', 404)
  if (!isVisibleTask({ id: taskDoc.id, ...taskData }, policies, projectAccess, scopedUser)) {
    return apiError('Task not found', 404)
  }

  const sourceDocumentId = typeof taskData.sourceDocumentId === 'string' ? taskData.sourceDocumentId.trim() : ''
  let source: Record<string, unknown> | null = null
  if (sourceDocumentId) {
    const sourceDoc = await projectRef.collection('docs').doc(sourceDocumentId).get()
    if (sourceDoc.exists) {
      const sourceData = sourceDoc.data() as Record<string, unknown>
      if (isVisibleDocument({ id: sourceDoc.id, ...sourceData }, policies, projectAccess, scopedUser)) {
        source = {
          id: sourceDoc.id,
          title: compactText(sourceData.title, 500),
          type: compactText(sourceData.type, 100),
          versionId: sourceData.versionId ?? sourceData.currentVersionId ?? taskData.sourceDocumentVersionId ?? taskData.sourceSpecVersion ?? null,
          sectionId: taskData.sourceDocumentSectionId ?? null,
          excerpt: compactText(sourceData.content ?? sourceData.summary, 4_000),
        }
      }
    }
    if (!source) source = { id: sourceDocumentId, unavailable: true }
  }

  const dependencyIds = [...new Set([
    ...(Array.isArray(taskData.dependsOn) ? taskData.dependsOn.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []),
    ...(typeof taskData.approvalGateTaskId === 'string' && taskData.approvalGateTaskId ? [taskData.approvalGateTaskId] : []),
  ])]
  const dependencies = await Promise.all(dependencyIds.slice(0, 20).map(async (dependencyId) => {
    const doc = await projectRef.collection('tasks').doc(dependencyId).get()
    if (!doc.exists) return null
    const data = doc.data() as Record<string, unknown>
    if (typeof data.projectId === 'string' && data.projectId && data.projectId !== projectId) return null
    if (!isVisibleTask({ id: doc.id, ...data }, policies, projectAccess, scopedUser)) return null
    return {
      id: doc.id,
      title: typeof data.title === 'string' ? data.title : '',
      agentStatus: data.agentStatus ?? null,
      approvalStatus: data.approvalStatus ?? null,
      reviewStatus: data.reviewStatus ?? null,
      output: compactAgentOutput(data.agentOutput),
      completionEvidence: data.completionEvidence ?? null,
    }
  }))

  const commentsSnapshot = await taskDoc.ref.collection('comments').orderBy('createdAt', 'desc').limit(8).get()
  const comments = commentsSnapshot.docs.reverse().map((doc) => {
    const data = doc.data()
    return { id: doc.id, text: compactText(data.text, MAX_COMMENT_CHARS), userName: data.userName ?? '', userRole: data.userRole ?? '', createdAt: data.createdAt ?? null }
  })

  return apiSuccess({
    contextVersion: 1,
    project: { id: projectId, name: projectData.name ?? '', status: projectData.status ?? '', orgId: projectData.orgId ?? '' },
    task: compactTask(taskDoc.id, taskData),
    ...(source ? { source } : {}),
    dependencies: dependencies.filter(Boolean),
    ...(dependencyIds.length > 20 ? { dependenciesOmittedCount: dependencyIds.length - 20 } : {}),
    comments,
  })
})
