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
  getWorkbenchBrowserSession,
  setWorkbenchBrowserSessionDriver,
  type SetWorkbenchBrowserSessionDriverInput,
} from '@/lib/messages/workbench/browser-session-store'
import {
  publicWorkbenchBrowserSession,
  workbenchBrowserActorKindFromHeader,
  type WorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface DriverDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  set: (input: SetWorkbenchBrowserSessionDriverInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('driven by the user')) return apiError('This browser session is being driven by you — the agent cannot take over while you are active', 409)
  console.error('[workbench-browser-driver-failed]', error)
  return apiError('Unable to change workbench browser driver', 500)
}

/**
 * Explicitly hands the wheel to `driver` ('user' | 'agent') — the UI's
 * "Take control" button and the agent skill's browser_take_control tool.
 * Body: `{ driver }`. The human's Take Control always wins; an agent can
 * never seize a session the human is actively driving.
 */
export async function handleSetBrowserDriver(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: DriverDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    set: setWorkbenchBrowserSessionDriver,
  },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.driver !== 'user' && body.driver !== 'agent') return apiError('driver must be user or agent', 400)

    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    const session = await dependencies.set({
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
      driver: body.driver as 'user' | 'agent',
      actorKind: workbenchBrowserActorKindFromHeader(request.headers.get('x-agent-actor')),
    })
    return apiSuccess(publicWorkbenchBrowserSession(session))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleSetBrowserDriver(request, user, convId, sessionId)
})
