import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

/**
 * Phase 2b moved live `git status` onto the workbench jobs queue
 * (`POST .../workbench/jobs` with `{ kind: 'git.status' }`, dispatched to the
 * linked computer) so the client can show progress and surface
 * approval/failure states instead of blocking on a device round trip here.
 * This GET stays fast and job-free — it just tells the client where to find
 * live data and keeps the event-derived Changes list as an instant fallback.
 */
export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId } = await (ctx as Params).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccessConversation(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  return apiSuccess({
    source: 'jobs',
    changes: [],
    message: 'Use Refresh to run git status on the linked computer.',
  })
})
