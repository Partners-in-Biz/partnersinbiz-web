import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import {
  enqueueDesktopControl,
  getWorkbenchDesktopSession,
  publicDesktopSession,
} from '@/lib/messages/workbench/desktop-session-store'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ convId: string; sessionId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  try {
    const { convId, sessionId } = await (ctx as Context).params
    await authorizeWorkbenchConversation(user, convId)
    const existing = await getWorkbenchDesktopSession(sessionId)
    if (existing.conversationId !== convId) return apiError('Not found', 404)
    if (existing.driver !== 'user') return apiError('Take control before clicking', 403)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const x = Number(body.x)
    const y = Number(body.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return apiError('x and y required', 400)
    const session = await enqueueDesktopControl(sessionId, { kind: 'click', x, y, button: body.button === 'right' ? 'right' : 'left' })
    return apiSuccess(publicDesktopSession(session))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    return apiError(error instanceof Error ? error.message : 'Unable to click', 500)
  }
})
