import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { createAgentMailboxReplyDraft } from '@/lib/mailbox/agentEmail'
import { agentMailboxActorFromUser, agentMailboxContextFromBody, authorizeAgentMailboxRequest } from '../_shared'

export const dynamic = 'force-dynamic'


export const POST = withAuth('admin', async (req: NextRequest, user) => {
  try {
    const body = await req.json().catch(() => ({}))
    const ctx = agentMailboxContextFromBody(body, user)
    if (!ctx.orgId) return apiError('orgId is required', 400)
    if (!ctx.uid) return apiError('uid or requestingUserId is required', 400)
    const delegation = await authorizeAgentMailboxRequest({
      user,
      orgId: ctx.orgId,
      uid: ctx.uid,
      actionClass: 'draft',
      delegationEvidenceId: body.delegationEvidenceId,
      delegationEvidence: body.delegationEvidence,
    })
    if (typeof body.sourceMessageId !== 'string' || !body.sourceMessageId.trim()) return apiError('sourceMessageId is required', 400)
    const result = await createAgentMailboxReplyDraft({
      orgId: ctx.orgId,
      uid: ctx.uid,
      delegation,
      sourceMessageId: body.sourceMessageId,
      accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      bodyText: typeof body.bodyText === 'string' ? body.bodyText : '',
      bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined,
    }, agentMailboxActorFromUser(user))
    return apiSuccess(result, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
