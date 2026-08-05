import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import { createWorkbenchBrowserSession, type CreateWorkbenchBrowserSessionInput } from '@/lib/messages/workbench/browser-session-store'
import {
  publicWorkbenchBrowserSession,
  sanitizeWorkbenchBrowserStartUrl,
  sanitizeWorkbenchBrowserViewport,
  workbenchBrowserActorKindFromHeader,
} from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string }> }
type RouteAuthorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface CreateDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<RouteAuthorization>
  create: (input: CreateWorkbenchBrowserSessionInput) => Promise<Awaited<ReturnType<typeof createWorkbenchBrowserSession>>>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('already active')) return apiError('This conversation already has an active workbench browser session', 409)
  if (message.includes('queue full')) return apiError('Computer workbench browser session queue is full', 429)
  console.error('[workbench-browser-create-failed]', error)
  return apiError('Unable to create workbench browser session', 500)
}

/**
 * Requests a new long-lived headless-Chrome browser control session (Phase
 * 4b) on the linked computer. Body: `{ startUrl?, viewport?: { width,
 * height }, allowPrivateNetwork? }`. Always starts `awaiting_approval` — a
 * real browser reaching the open internet from the linked computer is at
 * least as sensitive as an unattended file write, so a human must
 * explicitly approve it via the `/approve` route before any device claims
 * it. The browser itself is always headless; there is no
 * client-controllable option to disable that.
 *
 * Agent-initiated sessions (X-Agent-Actor header) default to
 * `allowPrivateNetwork: false` and can never self-grant private-network
 * access — the human flips it via the `/allow-private` route when the agent
 * may reach the user's own dev server.
 */
export async function handleCreateBrowserSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  dependencies: CreateDependencies = { authorize: authorizeWorkbenchConversation, create: createWorkbenchBrowserSession },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const startUrlResult = sanitizeWorkbenchBrowserStartUrl(body.startUrl)
    if (!startUrlResult.ok) return apiError('startUrl must be an http(s) URL without embedded credentials', 400)
    const viewportInput = body.viewport && typeof body.viewport === 'object' && !Array.isArray(body.viewport)
      ? body.viewport as Record<string, unknown>
      : {}
    const viewport = sanitizeWorkbenchBrowserViewport(viewportInput.width, viewportInput.height)
    if (!viewport) return apiError('viewport width/height must be numbers', 400)

    const authorization = await dependencies.authorize(user, conversationId)
    if (user.role !== 'admin' && user.role !== 'client') return apiError('Forbidden', 403)
    const initiator = workbenchBrowserActorKindFromHeader(request.headers.get('x-agent-actor')) ?? 'user'
    const allowPrivateNetwork = body.allowPrivateNetwork === true
    const session = await dependencies.create({
      conversationId: authorization.conversation.id,
      orgId: authorization.conversation.orgId,
      actorUserId: user.uid,
      actorRole: user.role,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      workspaceId: authorization.binding.workspaceId,
      mappingId: authorization.binding.mappingId,
      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
      ...(authorization.projectReplicaId ? { projectReplicaId: authorization.projectReplicaId } : {}),
      relativeFolder: authorization.relativeFolder,
      startUrl: startUrlResult.url,
      viewport,
      initiator,
      // Only the human's own create may grant private-network access; an
      // agent-initiated session always starts locked down.
      allowPrivateNetwork: initiator === 'user' ? allowPrivateNetwork : false,
    })
    return apiSuccess(publicWorkbenchBrowserSession(session), 202)
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Context).params
  return handleCreateBrowserSession(request, user, convId)
})
