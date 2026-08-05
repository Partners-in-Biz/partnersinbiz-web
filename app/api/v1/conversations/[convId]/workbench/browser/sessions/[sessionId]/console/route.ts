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
  enqueueBrowserSessionConsole,
  getWorkbenchBrowserSession,
  type EnqueueBrowserSessionConsoleInput,
} from '@/lib/messages/workbench/browser-session-store'
import {
  publicWorkbenchBrowserSession,
  workbenchBrowserActorKindFromHeader,
  type WorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface ConsoleDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  enqueue: (input: EnqueueBrowserSessionConsoleInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown, action: string) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench browser session is not running', 409)
  if (message.includes('control queue full')) return apiError('Workbench browser session control queue is full', 429)
  console.error(`[workbench-browser-console-${action}-failed]`, error)
  return apiError(`Unable to ${action} workbench browser console`, 500)
}

/**
 * POST — asks the device to publish its console ring (page console messages
 * and uncaught exceptions captured by the CDP supervisor). Read the result
 * back with GET .../console.
 */
export async function handleConsoleBrowserSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: ConsoleDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    enqueue: enqueueBrowserSessionConsole,
  },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
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
      actorKind: workbenchBrowserActorKindFromHeader(request.headers.get('x-agent-actor')),
    })
    return apiSuccess(publicWorkbenchBrowserSession(session))
  } catch (error) {
    return routeError(error, 'request')
  }
}

interface ConsoleGetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
}

/** GET — reads the most recent console ring: `{ entries, seq, atMs, status }`. */
export async function handleGetBrowserConsole(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: ConsoleGetDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchBrowserSession },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    const chunk = existing.progressChunks?.filter((c) => c.stream === 'console').at(-1)
    return apiSuccess({
      entries: chunk?.entries ?? null,
      seq: chunk?.seq ?? 0,
      atMs: chunk?.atMs ?? 0,
      status: existing.status,
    })
  } catch (error) {
    return routeError(error, 'read')
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleConsoleBrowserSession(request, user, convId, sessionId)
})

export const GET = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleGetBrowserConsole(request, user, convId, sessionId)
})
