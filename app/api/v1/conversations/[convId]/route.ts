/**
 * GET   /api/v1/conversations/[convId] — fetch a single conversation
 * PATCH /api/v1/conversations/[convId] — update metadata and Workspace access
 * DELETE /api/v1/conversations/[convId] — permanently delete a conversation
 *
 * Auth: participant in the conversation OR admin role
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { logActivity } from '@/lib/activity/log'
import {
  ConversationAccessConflictError,
  deleteConversation,
  getConversation,
  patchConversation,
  updateConversationAccess,
} from '@/lib/conversations/conversations'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { canAccessConversation, canManageConversationAccess, publicConversationView } from '@/lib/conversations/access'
import {
  ConversationParticipantError,
  resolveHumanConversationParticipants,
} from '@/lib/conversations/participant-access'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccessConversation(user, conversation)) {
      return apiError('Forbidden', 403)
    }

    return apiSuccess({ conversation: publicConversationView(conversation) })
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
      if (patch.title !== undefined || patch.archived !== undefined) {
        return apiError('Access changes cannot be combined with metadata changes', 400)
      }
      if (!canManageConversationAccess(user, conversation)) {
        return apiError('Only the conversation owner or an authorised administrator can manage access', 403)
      }
      if (!conversation.workspaceContext) return apiError('Access modes can only be managed for Workspace conversations', 400)
      if (!Number.isInteger(body.expectedAccessVersion) || Number(body.expectedAccessVersion) < 0) {
        return apiError('expectedAccessVersion is required when changing conversation access', 400)
      }

      const shareMode = body.shareMode ?? conversation.workspaceContext.shareMode
      if (shareMode !== 'private' && shareMode !== 'shared' && shareMode !== 'org') {
        return apiError('shareMode must be private, shared, or org', 400)
      }

      const ownerUid = conversation.workspaceContext.ownerUserId ?? conversation.startedBy
      const currentHumanUids = conversation.participants
        .filter((participant) => participant.kind === 'user')
        .map((participant) => participant.uid)
      const requestedUids = shareMode === 'private' ? [ownerUid] : (body.participantUids ?? currentHumanUids)

      let humanParticipants
      try {
        humanParticipants = await resolveHumanConversationParticipants({
          orgId: conversation.orgId,
          ownerUid,
          requestedUids,
          existingParticipants: conversation.participants,
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
        description: `Updated Workspace conversation access to ${shareMode} for ${participantUids.length} participant${participantUids.length === 1 ? '' : 's'}`,
        entityId: convId,
        entityType: 'conversation',
        entityTitle: conversation.title,
      }).catch(() => undefined)
      const updatedConversation = await getConversation(convId)
      return apiSuccess({ conversation: updatedConversation ? publicConversationView(updatedConversation) : null })
    }

    if (Object.keys(patch).length === 0) {
      return apiError('Nothing to update — supply title, archived, shareMode, and/or participantUids', 400)
    }

    await patchConversation(convId, patch)
    const updatedConversation = await getConversation(convId)
    return apiSuccess({ conversation: updatedConversation ? publicConversationView(updatedConversation) : null })
  },
)

export const DELETE = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccessConversation(user, conversation) || !canAccessOrg(user, conversation.orgId)) {
      return apiError('Forbidden', 403)
    }

    await logActivity({
      orgId: conversation.orgId,
      type: 'conversation_deleted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : 'admin',
      description: `Deleted conversation ${convId}`,
      entityId: convId,
      entityType: 'conversation',
      entityTitle: conversation.title,
    })
    await deleteConversation(convId)
    return apiSuccess({ id: convId })
  },
)
