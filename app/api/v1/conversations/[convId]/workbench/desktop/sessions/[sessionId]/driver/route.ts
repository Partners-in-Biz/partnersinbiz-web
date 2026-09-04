import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import {
  getWorkbenchDesktopSession,
  publicDesktopSession,
  setDesktopDriver,
} from '@/lib/messages/workbench/desktop-session-store'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ convId: string; sessionId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  try {
    const { convId, sessionId } = await (ctx as Context).params
    await authorizeWorkbenchConversation(user, convId)
    const existing = await getWorkbenchDesktopSession(sessionId)
    if (existing.conversationId !== convId) return apiError('Not found', 404)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const driver = body.driver === 'agent' ? 'agent' : 'user'
    const session = await setDesktopDriver(sessionId, driver)
    return apiSuccess(publicDesktopSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    return apiError(error instanceof Error ? error.message : 'Unable to set driver', 500)
  }
})
