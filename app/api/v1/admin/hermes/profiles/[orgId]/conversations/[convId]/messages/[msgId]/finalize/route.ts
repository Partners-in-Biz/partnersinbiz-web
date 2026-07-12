import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { callHermesJson, HERMES_RUNS_COLLECTION, requireHermesProfileAccess } from '@/lib/hermes/server'
import { getConversation, messagesCollection, touchConversation, updateMessage } from '@/lib/hermes/conversations'
import { classifyWorkspaceDispatchFailure, isSafeHermesLifecycleStatus } from '@/lib/workspaces/dispatch-errors'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; convId: string; msgId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, convId, msgId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId || conv.profile !== access.link.profile) return apiError('Conversation not found', 404)
  if (!conv.participantUids.includes(user.uid)) return apiError('Forbidden', 403)

  const msgDoc = await messagesCollection(convId).doc(msgId).get()
  if (!msgDoc.exists) return apiError('Message not found', 404)
  const message = msgDoc.data() ?? {}
  if (message.role !== 'assistant' || typeof message.runId !== 'string' || !message.runId.trim()) {
    return apiError('Message is not bound to an assistant run', 409)
  }

  const body = await req.json().catch(() => ({}))
  const runId = typeof body.runId === 'string' ? body.runId : ''
  if (!runId) return apiError('runId is required', 400)
  if (runId !== message.runId) return apiError('runId does not match this message', 409)

  const runSnap = await adminDb.collection(HERMES_RUNS_COLLECTION)
    .where('hermesRunId', '==', runId)
    .limit(10)
    .get()
  const boundRun = runSnap.docs.find((doc) => {
    const run = doc.data() as Record<string, unknown>
    return run.orgId === orgId
      && run.profile === access.link.profile
      && run.conversationId === convId
      && run.messageId === msgId
  })
  if (!boundRun) return apiError('Run is not bound to this conversation message', 409)

  const { response, data } = await callHermesJson(access.link, `/v1/runs/${encodeURIComponent(runId)}`)
  if (!response.ok) {
    if (response.status === 404) {
      const lostRunMessage = 'The agent gateway lost this run, likely after a restart. Streamed progress was preserved; start a deliberate follow-up if needed.'
      await updateMessage(convId, msgId, {
        content: lostRunMessage,
        status: 'failed',
        error: lostRunMessage,
        runId,
      })
      await touchConversation(convId, {
        lastMessagePreview: `[run interrupted] ${lostRunMessage}`.slice(0, 200),
        lastMessageRole: 'assistant',
      })
      return apiSuccess({ status: 'interrupted', output: lostRunMessage, error: lostRunMessage })
    }
    const failure = classifyWorkspaceDispatchFailure(data, response.status)
    return apiError(failure.message, response.status || 502, { dispatchError: failure })
  }

  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const rawStatus = typeof payload.status === 'string' ? payload.status : 'unknown'
  const status = isSafeHermesLifecycleStatus(rawStatus) ? rawStatus : 'unknown'
  const output = typeof payload.output === 'string' ? payload.output : ''
  const error = status === 'failed'
    ? 'The agent run failed before completion.'
    : ['cancelled', 'canceled', 'stopped'].includes(status)
      ? 'The agent run was stopped before completion.'
      : status === 'interrupted'
        ? 'The agent run was interrupted before completion.'
        : undefined

  if (status === 'completed') {
    await updateMessage(convId, msgId, {
      content: output,
      status: 'completed',
      runId,
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
