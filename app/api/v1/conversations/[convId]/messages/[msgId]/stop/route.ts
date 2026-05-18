/**
 * POST /api/v1/conversations/[convId]/messages/[msgId]/stop
 *
 * Admin-only kill switch for an in-flight unified chat agent run.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  getConversation,
  messagesCollection,
} from '@/lib/conversations/conversations'
import { callAgentPath } from '@/lib/agents/team'
import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ convId: string; msgId: string }> }

function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId, msgId } = await (ctx as Ctx).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccess(user, conversation.participantUids)) return apiError('Forbidden', 403)

  const msgRef = messagesCollection(convId).doc(msgId)
  const msgDoc = await msgRef.get()
  if (!msgDoc.exists) return apiError('Message not found', 404)

  const msg = msgDoc.data() ?? {}
  const runId = typeof msg.runId === 'string' ? msg.runId : ''
  if (!runId) return apiError('Message has no agent run id', 400)

  const agentId = typeof msg.authorId === 'string' && AGENT_IDS.includes(msg.authorId as AgentId)
    ? msg.authorId as AgentId
    : null
  if (!agentId) return apiError('Message author is not a known agent', 400)

  const upstream = await callAgentPath(agentId, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  }).catch((err) => ({
    response: new Response(null, { status: 502 }),
    data: { error: err instanceof Error ? err.message : 'Failed to reach agent gateway' },
  }))

  if (!upstream.response.ok && upstream.response.status !== 404) {
    return apiError('Agent gateway could not stop the run', upstream.response.status, { upstream: upstream.data })
  }

  await msgRef.update({
    content: '',
    status: 'failed',
    error: upstream.response.status === 404
      ? 'The agent gateway no longer has this run.'
      : 'Agent run stopped by admin',
    runId,
  })

  return apiSuccess({ id: msgId, runId, status: 'failed' })
})
