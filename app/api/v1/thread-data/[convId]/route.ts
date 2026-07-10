/**
 * GET /api/v1/thread-data/[convId] — list conversation messages through a
 * browser-extension-friendly alias that avoids common "chat/messages" filters.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getConversation, listMessages } from '@/lib/conversations/conversations'
import { canAccessConversation, publicConversationMessageView } from '@/lib/conversations/access'

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

    const messages = await listMessages(convId, 200)
    return apiSuccess({ messages: messages.map(publicConversationMessageView) })
  },
)
