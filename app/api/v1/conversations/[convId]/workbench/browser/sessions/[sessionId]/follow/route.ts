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
  enqueueBrowserSessionFollowStart,
  enqueueBrowserSessionFollowStop,
  getWorkbenchBrowserSession,
  type EnqueueBrowserSessionFollowStartInput,
  type EnqueueBrowserSessionFollowStopInput,
} from '@/lib/messages/workbench/browser-session-store'
import {
  publicWorkbenchBrowserSession,
  sanitizeWorkbenchBrowserFollowIntervalMs,
  type WorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-sessions'
import { workbenchBrowserActorKindFromHeader } from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface FollowDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  start: (input: EnqueueBrowserSessionFollowStartInput) => Promise<WorkbenchBrowserSession>
  stop: (input: EnqueueBrowserSessionFollowStopInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench browser session is not running', 409)
  if (message.includes('control queue full')) return apiError('Workbench browser session control queue is full', 429)
  console.error('[workbench-browser-follow-failed]', error)
  return apiError('Unable to change workbench browser session follow mode', 500)
}

/**
 * Starts or stops the device-side periodic capture loop for a claimed/running
 * browser session. Body: `{ action: 'start' | 'stop', intervalMs? }` — the
 * interval is clamped to 500-5000ms and defaults to 1000ms.
 */
export async function handleFollowBrowserSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: FollowDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    start: enqueueBrowserSessionFollowStart,
    stop: enqueueBrowserSessionFollowStop,
  },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.action !== 'start' && body.action !== 'stop') return apiError('action must be start or stop', 400)
    const intervalMs = sanitizeWorkbenchBrowserFollowIntervalMs(body.intervalMs)
    if (intervalMs === null) return apiError('intervalMs must be a number', 400)

    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    const binding = {
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
    }
    const session = body.action === 'start'
      ? await dependencies.start({ ...binding, intervalMs })
      : await dependencies.stop(binding)
    return apiSuccess(publicWorkbenchBrowserSession(session))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleFollowBrowserSession(request, user, convId, sessionId)
})
