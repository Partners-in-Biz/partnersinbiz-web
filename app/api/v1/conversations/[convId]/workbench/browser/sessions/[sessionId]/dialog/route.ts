import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeWorkbenchConversation,
  isWorkbenchBrowserSessionOwnedByContext,
  WorkbenchAuthorizationError,
} from '@/lib/messages/workbench/authorization'
import {
  enqueueBrowserSessionDialog,
  getWorkbenchBrowserSession,
  type EnqueueBrowserSessionDialogInput,
} from '@/lib/messages/workbench/browser-session-store'
import {
  publicWorkbenchBrowserSession,
  sanitizeWorkbenchBrowserDialog,
  workbenchBrowserActorKindFromHeader,
  type WorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; sessionId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface DialogDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (sessionId: string) => Promise<WorkbenchBrowserSession | null>
  enqueue: (input: EnqueueBrowserSessionDialogInput) => Promise<WorkbenchBrowserSession>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not running')) return apiError('Workbench browser session is not running', 409)
  if (message.includes('control queue full')) return apiError('Workbench browser session control queue is full', 429)
  console.error('[workbench-browser-dialog-failed]', error)
  return apiError('Unable to respond to workbench browser dialog', 500)
}

/** Responds to a pending native JS dialog (alert/confirm/prompt). Body: `{ accept, promptText? }`. */
export async function handleDialogBrowserSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  sessionId: string,
  dependencies: DialogDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchBrowserSession,
    enqueue: enqueueBrowserSessionDialog,
  },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const dialog = sanitizeWorkbenchBrowserDialog({ accept: body.accept, promptText: body.promptText })
    if (!dialog) return apiError('accept must be a boolean and promptText optional text', 400)

    const authorization = await dependencies.authorize(user, conversationId)
    const existing = await dependencies.get(sessionId)
    if (!existing || !isWorkbenchBrowserSessionOwnedByContext(existing, user, conversationId, authorization)) {
      return apiError('Workbench browser session not found', 404)
    }
    const session = await dependencies.enqueue({
      sessionId,
      conversationId: authorization.conversation.id,
      orgId: authorization.conversation.orgId,
      actorUserId: user.uid,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      workspaceId: authorization.binding.workspaceId,
      mappingId: authorization.binding.mappingId,
      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
      ...(authorization.projectReplicaId ? { projectReplicaId: authorization.projectReplicaId } : {}),
      relativeFolder: authorization.relativeFolder,
      ...(dialog.promptText !== undefined ? { promptText: dialog.promptText } : {}),
      accept: dialog.accept,
      actorKind: workbenchBrowserActorKindFromHeader(request.headers.get('x-agent-actor')),
    })
    return apiSuccess(publicWorkbenchBrowserSession(session))
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, sessionId } = await (context as Context).params
  return handleDialogBrowserSession(request, user, convId, sessionId)
})
