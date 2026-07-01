/**
 * GET /api/v1/thread-data/[convId] — list conversation messages through a
 * browser-extension-friendly alias that avoids common "chat/messages" filters.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getConversation, listMessages } from '@/lib/conversations/conversations'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccess(user, conversation.participantUids)) {
      return apiError('Forbidden', 403)
    }

    const messages = await listMessages(convId, 200)
    return apiSuccess({ messages })
  },
)
