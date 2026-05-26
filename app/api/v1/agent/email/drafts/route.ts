import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { createAgentMailboxDraft } from '@/lib/mailbox/agentEmail'
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
    const result = await createAgentMailboxDraft({
      orgId: ctx.orgId,
      uid: ctx.uid,
      delegation,
      accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: typeof body.subject === 'string' ? body.subject : '',
      bodyText: typeof body.bodyText === 'string' ? body.bodyText : '',
      bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined,
    }, agentMailboxActorFromUser(user))
    return apiSuccess(result, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
