/**
 * POST /api/v1/conversations/[convId]/messages/[msgId]/stop
 *
 * Kill switch for explicit conversation participants and scoped administrators.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  getConversation,
  messagesCollection,
} from '@/lib/conversations/conversations'
import { callAgentPath } from '@/lib/agents/team'
import { cancelLinkedRun } from '@/lib/linked-computers/run-queue-store'
import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canStopConversationRun } from '@/lib/conversations/access'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ convId: string; msgId: string }> }


export const POST = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId, msgId } = await (ctx as Ctx).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canStopConversationRun(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  const msgRef = messagesCollection(convId).doc(msgId)
  const msgDoc = await msgRef.get()
  if (!msgDoc.exists) return apiError('Message not found', 404)

  const msg = msgDoc.data() ?? {}
  const runId = typeof msg.runId === 'string' ? msg.runId : ''
  if (!runId) return apiError('Message has no agent run id', 400)

  if (typeof msg.linkedDeviceId === 'string' && msg.linkedDeviceId.trim()) {
    const cancellation = await cancelLinkedRun(
      runId,
      'Agent run stopped by an authorised conversation actor',
      {
        deviceId: msg.linkedDeviceId.trim(),
        conversationId: convId,
        assistantMessageId: msgId,
      },
    )
    if (cancellation.status === 'missing' || cancellation.status === 'binding_mismatch') {
      return apiError('Linked computer run not found', 404)
    }
    return apiSuccess({
      id: msgId,
      runId,
      status: cancellation.status,
      stopped: cancellation.won,
    })
  }

  const agentId = typeof msg.authorId === 'string' && AGENT_IDS.includes(msg.authorId as AgentId)
    ? msg.authorId as AgentId
    : null
  if (!agentId) return apiError('Message author is not a known agent', 400)

  const upstream = await callAgentPath(agentId, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  }, {
    runtimeTarget: typeof msg.dispatchRuntimeTargetId === 'string' && msg.dispatchRuntimeTargetId.trim()
      ? msg.dispatchRuntimeTargetId.trim()
      : conversation.workspaceContext?.runtimeTarget ?? null,
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
      : 'Agent run stopped by an authorised conversation actor',
    runId,
  })

  return apiSuccess({ id: msgId, runId, status: 'failed' })
})
