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
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callHermesJson } from '@/lib/hermes/server'
import { getAgentDecryptedKey } from '@/lib/agents/team'
import {
  getConversation,
  messagesCollection,
  touchConversation,
} from '@/lib/conversations/conversations'
import type { HermesProfileLink, ChatEvent } from '@/lib/hermes/types'
import type { ApiUser } from '@/lib/api/types'
import type { AgentId, AgentTeamDoc } from '@/lib/agents/types'

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
  const msgData = msgDoc.data() ?? {}

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (!runId) return apiError('runId is required', 400)

  const agentId = typeof body.agentId === 'string' ? body.agentId as AgentId : ''
  if (!agentId) return apiError('agentId is required', 400)

  const events: ChatEvent[] = Array.isArray(body.events) ? body.events as ChatEvent[] : []
  const createdAtMs = msgData.createdAt?.toMillis?.() ?? 0
  if (createdAtMs && Date.now() - createdAtMs > 30 * 60 * 1000) {
    await messagesCollection(convId).doc(msgId).update({
      content: '',
      status: 'failed',
      error: 'Agent run timed out after 30 minutes',
      runId,
    })
    return apiSuccess({ status: 'failed', content: '', runId })
  }

  // Read agent doc to get baseUrl + name
  const agentSnap = await adminDb.collection('agent_team').doc(agentId).get()
  if (!agentSnap.exists) return apiError('Agent not found', 404)
  const agentData = agentSnap.data() as AgentTeamDoc

  // Decrypt API key
  const decryptedKey = await getAgentDecryptedKey(agentId)

  // Build minimal HermesProfileLink
  const agentLink: HermesProfileLink = {
    orgId: conversation.orgId,
    profile: agentId,
    baseUrl: agentData.baseUrl,
    ...(decryptedKey ? { apiKey: decryptedKey } : {}),
    enabled: agentData.enabled,
    capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
    permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
  }

  // Fetch run status from Hermes
  const { response, data } = await callHermesJson(agentLink, `/v1/runs/${encodeURIComponent(runId)}`)
  if (!response.ok) {
    // 404 = run expired or never found — mark message as failed so UI stops polling
    if (response.status === 404) {
      await messagesCollection(convId).doc(msgId).update({
        content: '',
        status: 'failed',
        error: 'Run expired or not found on agent gateway',
        runId,
      })
      return apiSuccess({ status: 'failed', content: '', runId })
    }
    return apiError('Failed to fetch Hermes run', response.status || 502, { hermes: data })
  }

  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const status = String(payload.status ?? 'unknown')
  const output = typeof payload.output === 'string' ? payload.output : ''
  const error = typeof payload.error === 'string' ? payload.error : undefined

  if (status === 'completed') {
    await messagesCollection(convId).doc(msgId).update({
      content: output,
      status: 'completed',
      runId,
      ...(events.length > 0 ? { events } : {}),
    })
    await touchConversation(convId, output, 'assistant')
    return apiSuccess({ status, content: output, runId })
  }

  if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'stopped') {
    await messagesCollection(convId).doc(msgId).update({
      content: error || `Run ${status}`,
      status: 'failed',
      error: error ?? null,
      runId,
    })
    return apiSuccess({ status, content: error || `Run ${status}`, runId })
  }

  if (status === 'waiting_for_approval' || status === 'approval_required') {
    return apiSuccess({ status: 'waiting_approval', runId })
  }

  // Still running (submitted / running / pending) — caller should poll again
  return apiSuccess({ status: 'running', runId })
})
