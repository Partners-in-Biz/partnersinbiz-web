import { NextRequest } from 'next/server'
import { withMailboxAuth } from '@/lib/mailbox/mailboxAuth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { readAgentMailboxMessages, summarizeAgentMailboxContext } from '@/lib/mailbox/agentEmail'
import { isMailboxFolder } from '@/lib/mailbox/serializers'
import type { MailboxFolder } from '@/lib/mailbox/types'
import { agentMailboxActorFromUser, authorizeAgentMailboxRequest, resolveAgentMailboxContextFromRequest } from '../_shared'

export const dynamic = 'force-dynamic'

export const GET = withMailboxAuth('client', async (req: NextRequest, user) => {
  try {
    const ctx = await resolveAgentMailboxContextFromRequest(req, user)
    if (!ctx.orgId) return apiError('orgId is required', 400)
    if (!ctx.uid) return apiError('uid or requestingUserId is required', 400)
    const { searchParams } = ctx
    const rawFolder = searchParams.get('folder')
    const folder: MailboxFolder | 'all' | undefined = rawFolder === 'all' ? 'all' : isMailboxFolder(rawFolder) ? rawFolder : undefined
    const delegation = await authorizeAgentMailboxRequest({
      user,
      orgId: ctx.orgId,
      uid: ctx.uid,
      actionClass: 'read',
      delegationEvidenceId: searchParams.get('delegationEvidenceId'),
    })
    const input = {
      orgId: ctx.orgId,
      uid: ctx.uid,
      delegation,
      folder,
      accountId: searchParams.get('accountId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      limit: Number(searchParams.get('limit') ?? 25),
    }
    const summarize = searchParams.get('summarize') === 'true' || searchParams.get('summarise') === 'true'
    const result = summarize
      ? await summarizeAgentMailboxContext(input, agentMailboxActorFromUser(user))
      : await readAgentMailboxMessages(input, agentMailboxActorFromUser(user))
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
