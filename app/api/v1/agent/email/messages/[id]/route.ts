import { NextRequest } from 'next/server'
import { withMailboxAuth } from '@/lib/mailbox/mailboxAuth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { getAgentMailboxMessage } from '@/lib/mailbox/agentEmail'
import { agentMailboxActorFromUser, agentMailboxContextFromRequest, authorizeAgentMailboxRequest } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withMailboxAuth('client', async (req: NextRequest, user, context) => {
  try {
    const { id: messageId } = await (context as RouteContext).params
    if (!messageId?.trim()) return apiError('message id is required', 400)

    const ctx = agentMailboxContextFromRequest(req, user)
    if (!ctx.orgId) return apiError('orgId is required', 400)
    if (!ctx.uid) return apiError('uid or requestingUserId is required', 400)

    const delegation = await authorizeAgentMailboxRequest({
      user,
      orgId: ctx.orgId,
      uid: ctx.uid,
      actionClass: 'read',
      delegationEvidenceId: ctx.searchParams.get('delegationEvidenceId'),
    })

    const result = await getAgentMailboxMessage({
      orgId: ctx.orgId,
      uid: ctx.uid,
      messageId: messageId.trim(),
      delegation,
    }, agentMailboxActorFromUser(user))

    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
