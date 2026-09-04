import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import {
  getWorkbenchDesktopSession,
  publicDesktopSession,
} from '@/lib/messages/workbench/desktop-session-store'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ convId: string; sessionId: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  try {
    const { convId, sessionId } = await (ctx as Context).params
    await authorizeWorkbenchConversation(user, convId)
    const session = await getWorkbenchDesktopSession(sessionId)
    if (session.conversationId !== convId) return apiError('Not found', 404)
    return apiSuccess(publicDesktopSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    return apiError(error instanceof Error ? error.message : 'Unable to load desktop session', 500)
  }
})
