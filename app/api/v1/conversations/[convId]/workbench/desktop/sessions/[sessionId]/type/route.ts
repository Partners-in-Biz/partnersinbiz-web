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

/**
 * Type into the Mac desktop. When `sensitive: true`, the text is forwarded to
 * the runtime only and must never be written into chat transcripts.
 */
export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  try {
    const { convId, sessionId } = await (ctx as Context).params
    await authorizeWorkbenchConversation(user, convId)
    const existing = await getWorkbenchDesktopSession(sessionId)
    if (existing.conversationId !== convId) return apiError('Not found', 404)
    if (existing.driver !== 'user') return apiError('Take control before typing', 403)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text) return apiError('text required', 400)
    const sensitive = body.sensitive === true
    const session = await enqueueDesktopControl(sessionId, {
      kind: 'type',
      text,
      sensitive,
    })
    // Never echo sensitive text back to the client response payload beyond a flag.
    return apiSuccess({
      ...publicDesktopSession(session),
      typed: true,
      sensitive,
      ...(sensitive ? {} : { previewLength: text.length }),
    })
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    return apiError(error instanceof Error ? error.message : 'Unable to type', 500)
  }
})
