/**
 * POST /api/v1/conversations/[convId]/continue
 *
 * Continue a Workspace/project session on an explicitly selected computer.
 * The source binding is never mutated: a successor conversation receives a
 * fresh, immutable runtime binding and durable lineage back to the source.
 */
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'
import { authorizeConversationProject, canReplyConversation, publicConversationView } from '@/lib/conversations/access'
import { createConversation, getConversation } from '@/lib/conversations/conversations'
import { resolveConversationDispatchAgentId } from '@/lib/conversations/dispatch-agent'
import type { Participant } from '@/lib/conversations/types'
import {
  authorizeWorkspaceRuntime,
  workspaceRuntimeSupportsOrganizationSharing,
} from '@/lib/workspaces/runtime-authorization'
import {
  projectRuntimeReplicaApiError,
  requireProjectRuntimeReplica,
} from '@/lib/project-locations/runtime-binding'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

function successorParticipants(source: Participant[], user: ApiUser): Participant[] {
  const participants = [...source]
  if (!participants.some((participant) => participant.kind === 'user' && participant.uid === user.uid)) {
    participants.unshift({
      kind: 'user',
      uid: user.uid,
      role: user.role === 'admin' ? 'admin' : 'client',
    })
  }
  return participants
}

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const source = await getConversation(convId)
    if (!source) return apiError('Conversation not found', 404)
    if (!canReplyConversation(user, source)) return apiError('Forbidden', 403)
    if (!source.workspaceContext) return apiError('Only Workspace or project sessions can continue on another computer', 400)

    const startAccess = await assertUserCanPerformOrganizationModuleAction(
      user,
      source.orgId,
      'messages',
      'start',
      'Conversation starts are disabled for your organisation role',
    )
    if (!startAccess.ok) return apiError(startAccess.error, startAccess.status)

    const projectId = source.workspaceContext.projectId
      ?? (source.scope === 'project' ? source.scopeRefId : undefined)
    const projectAuthorization = await authorizeConversationProject(user, source)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

    const body = await req.json().catch(() => null)
    const runtimeTarget = body && typeof body.runtimeTarget === 'string' ? body.runtimeTarget.trim() : ''
    if (!runtimeTarget) return apiError('runtimeTarget is required', 400)
    const requestedMappingId = body && typeof body.mappingId === 'string' && body.mappingId.trim()
      ? body.mappingId.trim()
      : source.workspaceContext.mappingId
    if (requestedMappingId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestedMappingId)) {
      return apiError('mappingId is invalid', 400)
    }
    if (runtimeTarget === source.workspaceContext.runtimeTarget
      && (requestedMappingId || '') === (source.workspaceContext.mappingId || '')) {
      return apiError('Select a different computer or mapped location to continue this session', 400)
    }

    let authorizedRuntime: Awaited<ReturnType<typeof authorizeWorkspaceRuntime>>
    try {
      const dispatchAgentId = await resolveConversationDispatchAgentId(source)
      authorizedRuntime = await authorizeWorkspaceRuntime({
        userId: user.uid,
        orgId: source.orgId,
        workspaceId: source.workspaceContext.workspaceId,
        runtimeTargetId: runtimeTarget,
        ...(requestedMappingId ? { mappingId: requestedMappingId } : {}),
        ...(dispatchAgentId ? { agentId: dispatchAgentId } : {}),
      })
    } catch {
      return apiError('Computer unavailable', 409)
    }
    if ((source.workspaceContext.shareMode === 'org' || source.workspaceContext.shareMode === 'shared')
      && !workspaceRuntimeSupportsOrganizationSharing(authorizedRuntime)) {
      return apiError(
        source.workspaceContext.shareMode === 'shared'
          ? 'Shared sessions require an organisation-available computer'
          : 'Organisation-shared sessions require an organisation-available computer',
        400,
      )
    }
    let projectFolderRelativePath: string | undefined
    if (projectId) {
      try {
        const projectReplica = await requireProjectRuntimeReplica({
          projectId,
          orgId: source.orgId,
          workspaceId: source.workspaceContext.workspaceId,
          actorUserId: user.uid,
          runtime: authorizedRuntime,
        })
        projectFolderRelativePath = projectReplica.relativePath
      } catch (error) {
        const mapped = projectRuntimeReplicaApiError(error)
        return apiError(mapped.message, mapped.status)
      }
    }
    const runtimeLabel = authorizedRuntime.machineLabel

    const workspaceContext = await resolveConversationWorkspaceContext({
      orgId: source.orgId,
      workspaceId: source.workspaceContext.workspaceId,
      ownerUserId: user.uid,
      runtimeTarget,
      runtimeLabel,
      mappingId: 'mappingId' in authorizedRuntime ? authorizedRuntime.mappingId : requestedMappingId,
      mappingLabel: 'mappingLabel' in authorizedRuntime ? authorizedRuntime.mappingLabel : undefined,
      shareMode: source.workspaceContext.shareMode,
      projectId,
      projectName: source.workspaceContext.projectName,
      folderRelativePath: projectFolderRelativePath,
      companyId: source.workspaceContext.companyId,
      companyName: source.workspaceContext.companyName,
    })
    if (!workspaceContext) return apiError('Workspace not found for this organisation', 404)

    const conversation = await createConversation({
      orgId: source.orgId,
      startedBy: user.uid,
      participants: successorParticipants(source.participants ?? [], user),
      orchestration: source.orchestration,
      title: source.title,
      scope: source.scope,
      scopeRefId: source.scopeRefId,
      workspaceContext,
      contextRefs: source.contextRefs,
      lineage: {
        kind: 'runtime_continuation',
        parentConversationId: source.id,
        rootConversationId: source.lineage?.rootConversationId ?? source.id,
      },
    })

    await logActivity({
      orgId: source.orgId,
      type: 'conversation_runtime_continued',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role,
      description: `Continued ${source.title} on ${runtimeLabel}`,
      entityId: conversation.id,
      entityType: 'conversation',
      entityTitle: source.title,
    }).catch(() => undefined)

    return apiSuccess({ conversation: publicConversationView(conversation) }, 201)
  },
)
