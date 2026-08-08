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
  enqueueBrowserSessionExtract,
  getWorkbenchBrowserSession,
  type EnqueueBrowserSessionExtractInput,
} from '@/lib/messages/workbench/browser-session-store'
import { publicWorkbenchBrowserSession, type WorkbenchBrowserSession } from '@/lib/messages/workbench/browser-sessions'
import { workbenchBrowserActorKindFromHeader } from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface ExtractDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  enqueue: (input: EnqueueBrowserSessionExtractInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown, action: string) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench browser session is not running', 409)
  if (message.includes('control queue full')) return apiError('Workbench browser session control queue is full', 429)
  console.error(`[workbench-browser-extract-${action}-failed]`, error)
  return apiError(`Unable to ${action} workbench browser extraction`, 500)
}

/**
 * POST — queues a design-audit `extract` control: the device serializes the
 * live page (outerHTML + computed styles + console error tail) so the T1
 * rule engine can run its browser-mode hooks against the real rendered page.
 * Read the result back with GET .../extract (poll until seq advances).
 */
export async function handleExtractBrowserSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: ExtractDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    enqueue: enqueueBrowserSessionExtract,
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

interface ExtractGetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
}

/** GET — reads the most recent design-audit extraction the device posted. */
export async function handleGetBrowserExtract(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: ExtractGetDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchBrowserSession },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    const chunk = existing.progressChunks?.filter((c) => c.stream === 'extract').at(-1)
    return apiSuccess({
      extract: chunk?.extract ?? null,
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
  return handleExtractBrowserSession(request, user, convId, sessionId)
})

export const GET = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleGetBrowserExtract(request, user, convId, sessionId)
})
