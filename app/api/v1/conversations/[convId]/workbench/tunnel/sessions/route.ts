import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import { createTunnelSession, type CreateWorkbenchTunnelSessionInput } from '@/lib/messages/workbench/tunnel-session-store'
import { publicWorkbenchTunnelSession, sanitizeWorkbenchTunnelPort } from '@/lib/messages/workbench/tunnel-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string }> }
type RouteAuthorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface CreateDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<RouteAuthorization>
  create: (input: CreateWorkbenchTunnelSessionInput) => Promise<Awaited<ReturnType<typeof createTunnelSession>>>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('already active')) return apiError('This conversation already has an active workbench tunnel', 409)
  if (message.includes('queue full')) return apiError('Computer workbench tunnel queue is full', 429)
  console.error('[workbench-tunnel-create-failed]', error)
  return apiError('Unable to create workbench tunnel', 500)
}

/**
 * Requests a new outbound public tunnel (Phase 4b) from a localhost port on
 * the linked computer, so the Browser panel can iframe a public URL instead
 * of a `localhost` address the browser's own network stack can never
 * reach. Body: `{ port }`. Always starts `awaiting_approval` — a tunnel
 * briefly exposes a local port to the public internet, so a human must
 * explicitly approve it via the `/approve` route before any device claims
 * it. `bindHost` is always server-forced to `127.0.0.1` and `provider`
 * always defaults to `cloudflared` — a client can never request otherwise.
 */
export async function handleCreateTunnelSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  dependencies: CreateDependencies = { authorize: authorizeWorkbenchConversation, create: createTunnelSession },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const port = sanitizeWorkbenchTunnelPort(body.port)
    if (port === null) return apiError('port must be an integer between 1024 and 65535', 400)

    const authorization = await dependencies.authorize(user, conversationId)
    if (user.role !== 'admin' && user.role !== 'client') return apiError('Forbidden', 403)
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
      port,
    })
    return apiSuccess(publicWorkbenchTunnelSession(session), 202)
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Context).params
  return handleCreateTunnelSession(request, user, convId)
})
