/**
 * POST /api/v1/conversations/[convId]/messages/[msgId]/finalize
 *
 * Polls Hermes for a run result and writes it back to the conversation message.
 * Mirrors the hermes_conversations finalize pattern but uses the `conversations`
 * collection instead.
 *
 * Auth: participant in the conversation OR admin role
 * Body: { runId: string, agentId: AgentId, events?: ChatEvent[] }
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  getConversation,
  messagesCollection,
} from '@/lib/conversations/conversations'
import {
  finalizeConversationRun,
  HermesConversationRunError,
} from '@/lib/conversations/run-finalizer'
import type { ChatEvent } from '@/lib/hermes/types'
import type { ApiUser } from '@/lib/api/types'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ convId: string; msgId: string }> }

function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId, msgId } = await (ctx as Ctx).params

  // Verify conversation exists and caller is a participant
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccess(user, conversation.participantUids)) return apiError('Forbidden', 403)

  // Verify message exists
  const msgDoc = await messagesCollection(convId).doc(msgId).get()
  if (!msgDoc.exists) return apiError('Message not found', 404)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (!runId) return apiError('runId is required', 400)

  const agentId = typeof body.agentId === 'string' ? body.agentId as AgentId : ''
  if (!agentId) return apiError('agentId is required', 400)

  const events: ChatEvent[] = Array.isArray(body.events) ? body.events as ChatEvent[] : []
  try {
    const result = await finalizeConversationRun({
      convId,
      msgId,
      runId,
      agentId,
      events,
    })
    return apiSuccess(result)
  } catch (err) {
    if (err instanceof HermesConversationRunError) {
      return apiError(err.message, err.status, err.hermes ? { hermes: err.hermes } : undefined)
    }
    console.error('[conversation-run-finalize-error]', err)
    return apiError('Failed to fetch Hermes run', 502)
  }
})
