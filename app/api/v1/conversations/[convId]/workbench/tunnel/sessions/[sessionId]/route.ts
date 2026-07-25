import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchTunnelSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import { getTunnelSession } from '@/lib/messages/workbench/tunnel-session-store'
import { publicWorkbenchTunnelSession, type WorkbenchTunnelSession } from '@/lib/messages/workbench/tunnel-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface GetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchTunnelSession | null>
}

export async function handleGetTunnelSession(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: GetDependencies = { authorize: authorizeWorkbenchConversation, get: getTunnelSession },
): Promise<Response> {
  try {
    // Reauthorize the mutable conversation, project, grant and mapping before
    // reading the durable tunnel, mirroring the equivalent session route.
    const authorization = await dependencies.authorize(user, conversationId)
    const session = await dependencies.get(sessionId)
    if (!session || !isWorkbenchTunnelSessionOwnedByContext(session, user, conversationId, authorization)) {
      return apiError('Workbench tunnel not found', 404)
    }
    return apiSuccess(publicWorkbenchTunnelSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    console.error('[workbench-tunnel-read-failed]', error)
    return apiError('Unable to read workbench tunnel', 500)
  }
}

export const GET = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleGetTunnelSession(request, user, convId, sessionId)
})
