import { NextRequest } from 'next/server'
import { withMailboxAuth } from '@/lib/mailbox/mailboxAuth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { listAgentMailboxAccounts } from '@/lib/mailbox/agentEmail'
import { agentMailboxActorFromUser, agentMailboxContextFromRequest, authorizeAgentMailboxRequest } from '../_shared'

export const dynamic = 'force-dynamic'

export const GET = withMailboxAuth('client', async (req: NextRequest, user) => {
  try {
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
    const result = await listAgentMailboxAccounts({
      orgId: ctx.orgId,
      uid: ctx.uid,
      delegation,
    }, agentMailboxActorFromUser(user))
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
