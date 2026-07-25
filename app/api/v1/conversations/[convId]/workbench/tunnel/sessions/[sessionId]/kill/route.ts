import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchTunnelSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import { enqueueTunnelKill, getTunnelSession, type EnqueueTunnelKillInput } from '@/lib/messages/workbench/tunnel-session-store'
import { publicWorkbenchTunnelSession, type WorkbenchTunnelSession } from '@/lib/messages/workbench/tunnel-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface KillDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchTunnelSession | null>
  enqueue: (input: EnqueueTunnelKillInput) => Promise<WorkbenchTunnelSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench tunnel is not running', 409)
  console.error('[workbench-tunnel-kill-failed]', error)
  return apiError('Unable to kill workbench tunnel', 500)
}

/**
 * Kills a tunnel. An `awaiting_approval`/`queued` tunnel (never claimed by a
 * device — no live provider process exists yet) transitions straight to
 * `killed`; a `claimed`/`running` tunnel gets a `kill` control enqueued for
 * its owning device to deliver to the process, then the device reports the
 * final outcome via `complete`.
 */
export async function handleKillTunnelSession(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: KillDependencies = { authorize: authorizeWorkbenchConversation, get: getTunnelSession, enqueue: enqueueTunnelKill },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchTunnelSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench tunnel not found', 404)
    }
    const session = await dependencies.enqueue({
      sessionId,
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
    return apiSuccess(publicWorkbenchTunnelSession(session))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleKillTunnelSession(request, user, convId, sessionId)
})
