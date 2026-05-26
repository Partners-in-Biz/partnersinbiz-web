import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { readAgentMailboxMessages, summarizeAgentMailboxContext, type AgentMailboxActor } from '@/lib/mailbox/agentEmail'
import { isMailboxFolder } from '@/lib/mailbox/serializers'
import type { MailboxFolder } from '@/lib/mailbox/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function contextFromRequest(req: NextRequest, user: ApiUser): { orgId: string; uid: string } | { error: Response } {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId') ?? user.orgId
  const uid = searchParams.get('uid') ?? searchParams.get('requestingUserId') ?? (user.role === 'ai' ? null : user.uid)
  if (!orgId) return { error: apiError('orgId is required', 400) }
  if (!uid) return { error: apiError('uid or requestingUserId is required', 400) }
  if (user.role === 'ai' && user.orgId && user.orgId !== orgId) return { error: apiError('Forbidden for requested orgId', 403) }
  return { orgId, uid }
}

function actorFromUser(user: ApiUser): AgentMailboxActor {
  return { actorId: user.agentId ? `agent:${user.agentId}` : user.uid, actorType: user.role === 'ai' ? 'agent' : 'user' }
}

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  try {
    const ctx = contextFromRequest(req, user)
    if ('error' in ctx) return ctx.error
    const { searchParams } = new URL(req.url)
    const rawFolder = searchParams.get('folder')
    const folder: MailboxFolder | 'all' | undefined = rawFolder === 'all' ? 'all' : isMailboxFolder(rawFolder) ? rawFolder : undefined
    const input = {
      orgId: ctx.orgId,
      uid: ctx.uid,
      folder,
      accountId: searchParams.get('accountId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      limit: Number(searchParams.get('limit') ?? 25),
    }
    const summarize = searchParams.get('summarize') === 'true' || searchParams.get('summarise') === 'true'
    const result = summarize
      ? await summarizeAgentMailboxContext(input, actorFromUser(user))
      : await readAgentMailboxMessages(input, actorFromUser(user))
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
