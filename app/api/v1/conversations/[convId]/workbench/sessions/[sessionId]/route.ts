import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import { getWorkbenchSession } from '@/lib/messages/workbench/session-store'
import { publicWorkbenchSession, type WorkbenchSession } from '@/lib/messages/workbench/sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface GetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchSession | null>
}

export async function handleGetWorkbenchSession(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: GetDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchSession },
): Promise<Response> {
  try {
    // Reauthorize the mutable conversation, project, grant and mapping before
    // reading the durable session, mirroring the equivalent job route.
    const authorization = await dependencies.authorize(user, conversationId)
    const session = await dependencies.get(sessionId)
    if (!session || !isWorkbenchSessionOwnedByContext(session, user, conversationId, authorization)) {
      return apiError('Workbench session not found', 404)
    }
    return apiSuccess(publicWorkbenchSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    console.error('[workbench-session-read-failed]', error)
    return apiError('Unable to read workbench session', 500)
  }
}

const getWorkbenchSessionHandler = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleGetWorkbenchSession(request, user, convId, sessionId)
})

export const GET = (request: NextRequest, context?: unknown) =>
  runWithFirestoreReadAudit(
    'api/v1/conversations/:id/workbench/sessions/:id:get',
    () => getWorkbenchSessionHandler(request, context),
    { logEveryRun: true },
  )
