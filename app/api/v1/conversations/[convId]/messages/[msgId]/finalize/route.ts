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
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canReplyConversation } from '@/lib/conversations/access'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ convId: string; msgId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId, msgId } = await (ctx as Ctx).params

  // Verify conversation exists and caller is a participant
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canReplyConversation(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  // Verify message exists
  const msgDoc = await messagesCollection(convId).doc(msgId).get()
  if (!msgDoc.exists) return apiError('Message not found', 404)
  const message = msgDoc.data() ?? {}
  if (message.role !== 'assistant' || typeof message.runId !== 'string' || !message.runId.trim()) {
    return apiError('Message is not bound to an assistant run', 409)
  }
  const storedAgentId = typeof message.dispatchAgentId === 'string'
    ? message.dispatchAgentId.trim() as AgentId
    : ''
  if (!storedAgentId) return apiError('Message is not bound to a dispatch agent', 409)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (!runId) return apiError('runId is required', 400)
  if (runId !== message.runId.trim()) return apiError('runId does not match this message', 409)
  try {
    const result = await finalizeConversationRun({
      convId,
      msgId,
      runId,
      agentId: storedAgentId,
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
