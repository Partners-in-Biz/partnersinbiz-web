import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchBrowserSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import {
  approveWorkbenchBrowserSession,
  getWorkbenchBrowserSession,
  type ApproveWorkbenchBrowserSessionInput,
} from '@/lib/messages/workbench/browser-session-store'
import { publicWorkbenchBrowserSession, type WorkbenchBrowserSession } from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface ApproveDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  approve: (input: ApproveWorkbenchBrowserSessionInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('expired') || message.includes('not awaiting approval')) {
    return apiError('Workbench browser session is no longer awaiting approval', 409)
  }
  if (message.includes('binding mismatch')) return apiError('Workbench browser session not found', 404)
  if (message.includes('queue full')) return apiError('Computer workbench browser session queue is full', 429)
  console.error('[workbench-browser-approval-failed]', error)
  return apiError('Unable to approve workbench browser session', 500)
}

/**
 * Approves an `awaiting_approval` browser session, moving it to `queued` so
 * the owning device will claim its create control and spawn headless
 * Chrome. Only the session's own creator may approve it — enforced both by
 * `approveWorkbenchBrowserSession` (`approverUserId !== actorUserId`) and by
 * `isWorkbenchBrowserSessionOwnedByContext` re-checking `session.actorUserId
 * === user.uid` before this route ever calls it.
 */
export async function handleApproveBrowserSession(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: ApproveDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    approve: approveWorkbenchBrowserSession,
  },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    if (existing.status !== 'awaiting_approval') return apiError('Workbench browser session is no longer awaiting approval', 409)
    const approved = await dependencies.approve({
      sessionId,
      approverUserId: user.uid,
      conversationId: authorization.conversation.id,
      orgId: authorization.conversation.orgId,
      actorUserId: user.uid,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      workspaceId: authorization.binding.workspaceId,
      mappingId: authorization.binding.mappingId,
      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
      ...(authorization.projectReplicaId ? { projectReplicaId: authorization.projectReplicaId } : {}),
      relativeFolder: authorization.relativeFolder,
    })
    return apiSuccess(publicWorkbenchBrowserSession(approved))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleApproveBrowserSession(request, user, convId, sessionId)
})
