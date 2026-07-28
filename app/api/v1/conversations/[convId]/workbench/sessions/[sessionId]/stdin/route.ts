import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import { enqueueSessionStdin, getWorkbenchSession, type EnqueueSessionStdinInput } from '@/lib/messages/workbench/session-store'
import { publicWorkbenchSession, sanitizeWorkbenchSessionStdin, type WorkbenchSession } from '@/lib/messages/workbench/sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface StdinDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchSession | null>
  enqueue: (input: EnqueueSessionStdinInput) => Promise<WorkbenchSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench session is not running', 409)
  if (message.includes('control queue full')) return apiError('Workbench session input queue is full', 429)
  console.error('[workbench-session-stdin-failed]', error)
  return apiError('Unable to send workbench session input', 500)
}

export async function handleWorkbenchSessionStdin(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: StdinDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchSession, enqueue: enqueueSessionStdin },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const stdin = sanitizeWorkbenchSessionStdin(body.data, body.mode)
    if (!stdin) return apiError('data must be a non-empty string up to 8KB with mode "line" or "raw"', 400)

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
      ...(authorization.rootBindingId ? { rootBindingId: authorization.rootBindingId } : {}),
      relativeFolder: authorization.relativeFolder,
      data: stdin.data,
      mode: stdin.mode,
    })
    return apiSuccess(publicWorkbenchSession(session))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleWorkbenchSessionStdin(request, user, convId, sessionId)
})
