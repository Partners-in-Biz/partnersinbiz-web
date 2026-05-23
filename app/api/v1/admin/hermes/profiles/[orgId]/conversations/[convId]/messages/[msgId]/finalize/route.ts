import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callHermesJson, requireHermesProfileAccess } from '@/lib/hermes/server'
import { getConversation, messagesCollection, touchConversation, updateMessage } from '@/lib/hermes/conversations'
import type { ChatEvent } from '@/lib/hermes/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; convId: string; msgId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, convId, msgId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId) return apiError('Conversation not found', 404)
  if (!conv.participantUids.includes(user.uid)) return apiError('Forbidden', 403)

  const msgDoc = await messagesCollection(convId).doc(msgId).get()
  if (!msgDoc.exists) return apiError('Message not found', 404)

  const body = await req.json().catch(() => ({}))
  const runId = typeof body.runId === 'string' ? body.runId : ''
  if (!runId) return apiError('runId is required', 400)

  const events: ChatEvent[] = Array.isArray(body.events) ? body.events : []

  const { response, data } = await callHermesJson(access.link, `/v1/runs/${encodeURIComponent(runId)}`)
  if (!response.ok) {
    return apiError('Failed to fetch Hermes run', response.status || 502, { hermes: data })
  }

  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const status = String(payload.status ?? 'unknown')
  const output = typeof payload.output === 'string' ? payload.output : ''
  const error = typeof payload.error === 'string' ? payload.error : undefined

  if (status === 'completed') {
    await updateMessage(convId, msgId, {
      content: output,
      status: 'completed',
      runId,
      ...(events.length > 0 ? { events } : {}),
    })
    await touchConversation(convId, {
      lastMessagePreview: output,
      lastMessageRole: 'assistant',
    })
  } else if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'stopped' || status === 'interrupted') {
    await updateMessage(convId, msgId, {
      content: error || `Run ${status}`,
      status: 'failed',
      error,
      runId,
      ...(events.length > 0 ? { events } : {}),
    })
    await touchConversation(convId, {
      lastMessagePreview: `[run ${status}] ${error || ''}`.slice(0, 200),
      lastMessageRole: 'assistant',
    })
  } else if (status === 'waiting_for_approval' || status === 'approval_required') {
    return apiSuccess({ status, pending: false, waitingForApproval: true })
  } else {
    return apiSuccess({ status, pending: true })
  }

  return apiSuccess({ status, output, error })
})
