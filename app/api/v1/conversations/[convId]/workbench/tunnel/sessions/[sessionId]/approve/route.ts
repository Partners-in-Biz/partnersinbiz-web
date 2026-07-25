import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchTunnelSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import {
  approveTunnelSession,
  getTunnelSession,
  type ApproveTunnelSessionInput,
} from '@/lib/messages/workbench/tunnel-session-store'
import { publicWorkbenchTunnelSession, type WorkbenchTunnelSession } from '@/lib/messages/workbench/tunnel-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface ApproveDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchTunnelSession | null>
  approve: (input: ApproveTunnelSessionInput) => Promise<WorkbenchTunnelSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('expired') || message.includes('not awaiting approval')) {
    return apiError('Workbench tunnel is no longer awaiting approval', 409)
  }
  if (message.includes('binding mismatch')) return apiError('Workbench tunnel not found', 404)
  if (message.includes('queue full')) return apiError('Computer workbench tunnel queue is full', 429)
  console.error('[workbench-tunnel-approval-failed]', error)
  return apiError('Unable to approve workbench tunnel', 500)
}

/**
 * Approves an `awaiting_approval` tunnel, moving it to `queued` so the
 * owning device will claim its create control and spawn the provider
 * process. Only the tunnel's own creator may approve it — enforced both by
 * `approveTunnelSession` (`approverUserId !== actorUserId`) and by
 * `isWorkbenchTunnelSessionOwnedByContext` re-checking `session.actorUserId
 * === user.uid` before this route ever calls it.
 */
export async function handleApproveTunnelSession(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: ApproveDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getTunnelSession,
    approve: approveTunnelSession,
  },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchTunnelSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench tunnel not found', 404)
    }
    if (existing.status !== 'awaiting_approval') return apiError('Workbench tunnel is no longer awaiting approval', 409)
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
    return apiSuccess(publicWorkbenchTunnelSession(approved))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleApproveTunnelSession(request, user, convId, sessionId)
})
