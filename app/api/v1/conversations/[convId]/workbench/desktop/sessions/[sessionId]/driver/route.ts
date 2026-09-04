import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { appendSystemEvent } from '@/lib/conversations/system-events'
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
    // Conversation-auth route is always the human — agents cannot call this path.
    const session = await setDesktopDriver(sessionId, driver, { actorKind: 'user' })
    const actorLabel = 'You'
    await appendSystemEvent({
      convId,
      event: {
        eventKind: driver === 'user' ? 'driver.take_control' : 'driver.hand_back',
        actorKind: 'user',
        actorLabel,
        summary: driver === 'user'
          ? 'Took control of the desktop'
          : 'Handed the desktop back to the agent',
      },
    }).catch(() => undefined)
    return apiSuccess(publicDesktopSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    const message = error instanceof Error ? error.message : 'Unable to set driver'
    if (/being driven by the user/i.test(message)) return apiError(message, 409)
    return apiError(message, 500)
  }
})
