import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import {
  createWorkbenchDesktopSession,
  publicDesktopSession,
} from '@/lib/messages/workbench/desktop-session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  try {
    const { convId } = await (ctx as Context).params
    const authorization = await authorizeWorkbenchConversation(user, convId)
    const session = await createWorkbenchDesktopSession({
      conversationId: authorization.conversation.id,
      orgId: authorization.conversation.orgId,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      actorUserId: user.uid,
    })
    return apiSuccess(publicDesktopSession(session), 201)
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    return apiError(error instanceof Error ? error.message : 'Unable to create desktop session', 500)
  }
})

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  try {
    const { convId } = await (ctx as Context).params
    await authorizeWorkbenchConversation(user, convId)
    return apiSuccess({ sessions: [] })
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    return apiError('Unable to list desktop sessions', 500)
  }
})
