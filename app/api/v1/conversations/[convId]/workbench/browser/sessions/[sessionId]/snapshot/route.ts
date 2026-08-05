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
  enqueueBrowserSessionSnapshot,
  getWorkbenchBrowserSession,
  type EnqueueBrowserSessionSnapshotInput,
} from '@/lib/messages/workbench/browser-session-store'
import {
  publicWorkbenchBrowserSession,
  workbenchBrowserActorKindFromHeader,
  type WorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface SnapshotDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  enqueue: (input: EnqueueBrowserSessionSnapshotInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown, action: string) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench browser session is not running', 409)
  if (message.includes('control queue full')) return apiError('Workbench browser session control queue is full', 429)
  console.error(`[workbench-browser-snapshot-${action}-failed]`, error)
  return apiError(`Unable to ${action} workbench browser snapshot`, 500)
}

/**
 * POST — requests a fresh accessibility-tree snapshot of the session's
 * current page. The device posts the result as a `snapshot` progress chunk;
 * read it back with GET .../snapshot (poll until seq advances). The
 * snapshot is the agent's eyes: the page rendered as text with stable @eN
 * refs, plus pending native dialogs, the frame tree and recent console
 * errors — the Hermes browser_supervisor pattern.
 */
export async function handleSnapshotBrowserSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: SnapshotDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    enqueue: enqueueBrowserSessionSnapshot,
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

interface SnapshotGetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
}

/**
 * GET — reads the most recent accessibility snapshot the device posted (a
 * `snapshot` progress chunk). Returns `{ snapshot, seq, atMs, status }`
 * where snapshot is null until the first POST /snapshot completes — poll
 * with the previous seq to wait for a fresh capture.
 */
export async function handleGetBrowserSnapshot(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: SnapshotGetDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchBrowserSession },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    const chunk = existing.progressChunks?.filter((c) => c.stream === 'snapshot').at(-1)
    return apiSuccess({
      snapshot: chunk?.snapshot ?? null,
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
  return handleSnapshotBrowserSession(request, user, convId, sessionId)
})

export const GET = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleGetBrowserSnapshot(request, user, convId, sessionId)
})
