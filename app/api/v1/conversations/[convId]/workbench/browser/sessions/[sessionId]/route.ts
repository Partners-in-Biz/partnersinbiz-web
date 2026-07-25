import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchBrowserSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import { getWorkbenchBrowserSession } from '@/lib/messages/workbench/browser-session-store'
import { publicWorkbenchBrowserSession, type WorkbenchBrowserSession } from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface GetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
}

export async function handleGetBrowserSession(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: GetDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchBrowserSession },
): Promise<Response> {
  try {
    // Reauthorize the mutable conversation, project, grant and mapping before
    // reading the durable session, mirroring the equivalent pty session route.
    const authorization = await dependencies.authorize(user, conversationId)
    const session = await dependencies.get(sessionId)
    if (!session || !isWorkbenchBrowserSessionOwnedByContext(session, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    return apiSuccess(publicWorkbenchBrowserSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    console.error('[workbench-browser-read-failed]', error)
    return apiError('Unable to read workbench browser session', 500)
  }
}

export const GET = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleGetBrowserSession(request, user, convId, sessionId)
})
