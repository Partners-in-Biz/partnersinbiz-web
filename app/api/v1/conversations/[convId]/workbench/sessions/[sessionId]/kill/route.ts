import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import { enqueueSessionKill, getWorkbenchSession, type EnqueueSessionKillInput } from '@/lib/messages/workbench/session-store'
import { publicWorkbenchSession, type WorkbenchSession } from '@/lib/messages/workbench/sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface KillDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchSession | null>
  enqueue: (input: EnqueueSessionKillInput) => Promise<WorkbenchSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('control queue full')) return apiError('Workbench session input queue is full', 429)
  console.error('[workbench-session-kill-failed]', error)
  return apiError('Unable to kill workbench session', 500)
}

/**
 * Kills a session. A `queued` session (never claimed by a device — no live
 * pty exists yet) transitions straight to `killed`; a `claimed`/`running`
 * session gets a `kill` control enqueued for its owning device to deliver
 * to the pty, then the device reports the final outcome via `complete`.
 */
export async function handleWorkbenchSessionKill(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: KillDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchSession, enqueue: enqueueSessionKill },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench session not found', 404)
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
    return apiSuccess(publicWorkbenchSession(session))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleWorkbenchSessionKill(request, user, convId, sessionId)
})
