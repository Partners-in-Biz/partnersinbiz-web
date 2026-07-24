import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

/**
 * Phase 2a has no `git status` / `git diff` runtime job yet (that lands in
 * Phase 2b, once workbench jobs can be dispatched to a linked-runtime like
 * project-sync inventory jobs are today). This endpoint exists so the client
 * has a stable contract to call and a clear reason to keep showing the
 * event-derived Changes list (`buildWorkbenchChanges`) in the meantime,
 * instead of a client-side guess about why live changes aren't available.
 */
export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId } = await (ctx as Params).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccessConversation(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  return apiSuccess({
    source: 'pending_runtime',
    changes: [],
    message: 'Live git status requires linked-runtime workbench jobs (Phase 2b). Showing activity derived from this session for now.',
  })
})
