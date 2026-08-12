/**
 * GET   /api/v1/conversations/[convId] — fetch a single conversation
 * PATCH /api/v1/conversations/[convId] — update metadata and Workspace access
 * DELETE /api/v1/conversations/[convId] — permanently delete a conversation
 *
 * Read auth: explicit participant, or an organisation member for org-visible Workspace conversations.
 * Mutation auth is purpose-specific: metadata/access and deletion require owner or scoped-admin authority.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import {
  ConversationAccessConflictError,
  deleteConversation,
  getConversation,
  patchConversation,
  updateConversationAccess,
} from '@/lib/conversations/conversations'
import { getOrgChatVisibilityPolicy } from '@/lib/conversations/chat-config'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import {
  authorizeConversationProject,
  canAccessConversation,
  canDeleteConversation,
  canManageConversationAccess,
  publicConversationView,
} from '@/lib/conversations/access'
import { evaluateCrossOrgConversationAccess } from '@/lib/conversations/cross-org'
import {
  ConversationParticipantError,
  resolveHumanConversationParticipants,
} from '@/lib/conversations/participant-access'
import { resolveConversationDispatchAgentId } from '@/lib/conversations/dispatch-agent'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'
import {
  authorizeWorkspaceRuntime,
  workspaceRuntimeSupportsOrganizationSharing,
} from '@/lib/workspaces/runtime-authorization'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    const access = conversation.crossOrg
      ? await evaluateCrossOrgConversationAccess({ conversation, user, action: 'read' })
      : null
    if (conversation.crossOrg ? !access?.allowed : !canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    const foreignCrossOrgParticipant = Boolean(
      conversation.crossOrg && user.orgId !== conversation.crossOrg.ownerOrgId,
    )
    if (!foreignCrossOrgParticipant) {
      const projectAuthorization = await authorizeConversationProject(user, conversation)
      if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)
    }

    return apiSuccess({ conversation: publicConversationView(conversation, user.uid) })
  },
)

export const PATCH = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const patch: {
      title?: string
      archived?: boolean
      participants?: Conversation['participants']
      participantUids?: string[]
      workspaceContext?: Conversation['workspaceContext']
    } = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') return apiError('title must be a string', 400)
      patch.title = body.title
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') return apiError('archived must be a boolean', 400)
      patch.archived = body.archived
    }
    if (patch.archived === true) {
      const archiveAccess = await assertUserCanPerformOrganizationModuleAction(
        user,
        conversation.orgId,
        'messages',
        'archive',
        'Conversation archive is disabled for your organisation role',
      )
      if (!archiveAccess.ok) return apiError(archiveAccess.error, archiveAccess.status)
    }

    const hasAccessUpdate = body.shareMode !== undefined || body.participantUids !== undefined
    if (hasAccessUpdate) {
      // The legacy access mutation stores only same-org participants. Applying
      // it to a bilateral thread could silently drop the canonical foreign
      // principal list, so it is never a cross-org management path.
      if (conversation.crossOrg) {
        return apiError('Cross-organisation participant changes require the canonical cross-org participant workflow', 400)
      }
      if (patch.title !== undefined || patch.archived !== undefined) {
        return apiError('Access changes cannot be combined with metadata changes', 400)
      }
      if (!canManageConversationAccess(user, conversation)) {
        return apiError('Only the conversation owner or an authorised administrator can manage access', 403)
      }
      if (!Number.isInteger(body.expectedAccessVersion) || Number(body.expectedAccessVersion) < 0) {
        return apiError('expectedAccessVersion is required when changing conversation access', 400)
      }

      const workspaceConversation = Boolean(conversation.workspaceContext)
      if (!workspaceConversation && body.shareMode !== undefined) {
        return apiError('Direct and group chats use explicit participants, not Workspace access modes', 400)
      }
      const shareMode = workspaceConversation
        ? body.shareMode ?? conversation.workspaceContext!.shareMode
        : undefined
      if (workspaceConversation && shareMode !== 'private' && shareMode !== 'shared' && shareMode !== 'org') {
        return apiError('shareMode must be private, shared, or org', 400)
      }
      if (conversation.workspaceContext && (shareMode === 'org' || shareMode === 'shared')) {
        try {
          const dispatchAgentId = await resolveConversationDispatchAgentId(conversation)
          const runtime = await authorizeWorkspaceRuntime({
            userId: user.uid,
            orgId: conversation.orgId,
            workspaceId: conversation.workspaceContext.workspaceId,
            runtimeTargetId: conversation.workspaceContext.runtimeTarget,
            ...(dispatchAgentId ? { agentId: dispatchAgentId } : {}),
          })
          if (!workspaceRuntimeSupportsOrganizationSharing(runtime)) {
            return apiError(
              shareMode === 'shared'
                ? 'Shared sessions require an organisation-available computer'
                : 'Organisation-shared sessions require an organisation-available computer',
              400,
            )
          }
        } catch {
          return apiError('Computer unavailable', 409)
        }
      }

      const ownerUid = conversation.workspaceContext?.ownerUserId ?? conversation.startedBy
      const currentHumanUids = conversation.participants
        .filter((participant) => participant.kind === 'user')
        .map((participant) => participant.uid)
      const requestedUids = shareMode === 'private' ? [ownerUid] : (body.participantUids ?? currentHumanUids)
      const chatPolicy = await getOrgChatVisibilityPolicy(conversation.orgId)

      let humanParticipants
      try {
        humanParticipants = await resolveHumanConversationParticipants({
          orgId: conversation.orgId,
          ownerUid,
          requestedUids,
          existingParticipants: conversation.participants,
          policy: {
            requestingUserRole: user.role,
            enforceClientChatPolicy: true,
            allowClientToAdminChat: chatPolicy.enableClientToAdminChat,
            allowClientToPiBTeamChat: chatPolicy.enableClientToPiBTeamChat,
          },
        })
      } catch (error) {
        if (error instanceof ConversationParticipantError) return apiError(error.message, error.status)
        throw error
      }

      if (shareMode === 'shared' && humanParticipants.every((participant) => participant.uid === ownerUid)) {
        return apiError('Shared Workspace conversations require at least one additional human participant', 400)
      }

      const agentParticipants = conversation.participants.filter((participant) => participant.kind === 'agent')
      const participants = [...humanParticipants, ...agentParticipants]
      const participantUids = humanParticipants.map((participant) => participant.uid)
      const participantAgentIds = agentParticipants.map((participant) => participant.agentId)
      try {
        await updateConversationAccess({
          convId,
          expectedOrgId: conversation.orgId,
          expectedVersion: Number(body.expectedAccessVersion),
          shareMode,
          participants,
          participantUids,
          participantAgentIds,
          actor: { uid: user.uid, role: user.role },
        })
      } catch (error) {
        if (error instanceof ConversationAccessConflictError) {
          return apiError(`Conversation access changed; reload and try again (version ${error.currentVersion})`, 409)
        }
        throw error
      }

      await logActivity({
        orgId: conversation.orgId,
        type: 'conversation_access_updated',
        actorId: user.uid,
        actorName: user.uid,
        actorRole: user.role,
        description: workspaceConversation
          ? `Updated Workspace conversation access to ${shareMode} for ${participantUids.length} participant${participantUids.length === 1 ? '' : 's'}`
          : `Updated conversation participants to ${participantUids.length} person${participantUids.length === 1 ? '' : 's'}`,
        entityId: convId,
        entityType: 'conversation',
        entityTitle: conversation.title,
      }).catch(() => undefined)
      const updatedConversation = await getConversation(convId)
      return apiSuccess({
        conversation: updatedConversation ? publicConversationView(updatedConversation, user.uid) : null,
      })
    }

    if (Object.keys(patch).length === 0) {
      return apiError('Nothing to update — supply title, archived, shareMode, and/or participantUids', 400)
    }

    if (!canManageConversationAccess(user, conversation)) {
      return apiError('Only the conversation owner or an authorised administrator can update conversation metadata', 403)
    }

    await patchConversation(convId, patch)
    const updatedConversation = await getConversation(convId)
    return apiSuccess({
      conversation: updatedConversation ? publicConversationView(updatedConversation, user.uid) : null,
    })
  },
)

export const DELETE = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canDeleteConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }
    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

    await logActivity({
      orgId: conversation.orgId,
      type: 'conversation_deleted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role,
      description: `Deleted conversation ${convId}`,
      entityId: convId,
      entityType: 'conversation',
      entityTitle: conversation.title,
    })
    await deleteConversation(convId)
    return apiSuccess({ id: convId })
  },
)
