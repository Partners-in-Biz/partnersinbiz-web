import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { requestAgentMailboxSend } from '@/lib/mailbox/agentEmail'
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
      actionClass: 'send',
      delegationEvidenceId: body.delegationEvidenceId,
      delegationEvidence: body.delegationEvidence,
    })
    if (typeof body.accountId !== 'string' || !body.accountId.trim()) return apiError('accountId is required', 400)
    const result = await requestAgentMailboxSend({
      orgId: ctx.orgId,
      uid: ctx.uid,
      delegation,
      accountId: body.accountId,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: typeof body.subject === 'string' ? body.subject : '',
      bodyText: typeof body.bodyText === 'string' ? body.bodyText : '',
      bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined,
      dryRun: body.dryRun === true,
      approvalEvidence: body.approvalEvidence,
    }, agentMailboxActorFromUser(user))
    return apiSuccess(result, 202)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send request failed'
    if (/approval evidence|required|recipient|subject or body/i.test(message)) return apiError(message, 400)
    return apiErrorFromException(err)
  }
})
