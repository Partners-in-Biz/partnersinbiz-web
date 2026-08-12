import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeConversationProject,
  canAccessConversation,
  publicConversationView,
} from '@/lib/conversations/access'
import {
  ConversationReadConflictError,
  getConversation,
  markConversationRead,
} from '@/lib/conversations/conversations'
import { evaluateCrossOrgConversationAccess } from '@/lib/conversations/cross-org'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    if (user.role === 'ai') return apiError('Read state is available to human members only', 403)
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

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)
    const rawLastMessageId = (body as { lastMessageId?: unknown }).lastMessageId
    if (rawLastMessageId !== null && typeof rawLastMessageId !== 'string') {
      return apiError('lastMessageId must be a string or null', 400)
    }
    const lastMessageId = typeof rawLastMessageId === 'string' ? rawLastMessageId.trim() : null
    if (typeof rawLastMessageId === 'string' && !lastMessageId) {
      return apiError('lastMessageId must not be empty', 400)
    }

    try {
      await markConversationRead({
        convId,
        userId: user.uid,
        ...(access?.principalId ? { readKey: access.principalId } : {}),
        lastMessageId,
      })
    } catch (error) {
      if (error instanceof ConversationReadConflictError) {
        return apiError('Conversation changed; refresh before marking it read', 409, {
          currentLastMessageId: error.currentLastMessageId,
        })
      }
      throw error
    }

    const updated = await getConversation(convId)
    return apiSuccess({
      conversation: updated ? publicConversationView(updated, user.uid) : null,
    })
  },
)
