import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { createAgentMailboxDraft, type AgentMailboxActor } from '@/lib/mailbox/agentEmail'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function actorFromUser(user: ApiUser): AgentMailboxActor {
  return { actorId: user.agentId ? `agent:${user.agentId}` : user.uid, actorType: user.role === 'ai' ? 'agent' : 'user' }
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  try {
    const body = await req.json().catch(() => ({}))
    const orgId = typeof body.orgId === 'string' ? body.orgId : user.orgId
    const uid = typeof body.uid === 'string' ? body.uid : typeof body.requestingUserId === 'string' ? body.requestingUserId : user.role === 'ai' ? null : user.uid
    if (!orgId) return apiError('orgId is required', 400)
    if (!uid) return apiError('uid or requestingUserId is required', 400)
    if (user.role === 'ai' && user.orgId && user.orgId !== orgId) return apiError('Forbidden for requested orgId', 403)
    const result = await createAgentMailboxDraft({
      orgId,
      uid,
      accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: typeof body.subject === 'string' ? body.subject : '',
      bodyText: typeof body.bodyText === 'string' ? body.bodyText : '',
      bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined,
    }, actorFromUser(user))
    return apiSuccess(result, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
