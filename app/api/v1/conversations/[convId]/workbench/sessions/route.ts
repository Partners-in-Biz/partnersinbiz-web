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
import { createWorkbenchSession, listActiveSessionsForConversation, type CreateWorkbenchSessionInput } from '@/lib/messages/workbench/session-store'
import {
  publicWorkbenchSession,
  resolveWorkbenchSessionShell,
  sanitizeWorkbenchSessionCwd,
  sanitizeWorkbenchSessionDimensions,
} from '@/lib/messages/workbench/sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string }> }
type RouteAuthorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface CreateDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<RouteAuthorization>
  create: (input: CreateWorkbenchSessionInput) => Promise<Awaited<ReturnType<typeof createWorkbenchSession>>>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('already active')) return apiError('This conversation already has an active workbench session', 409)
  if (message.includes('queue full')) return apiError('Computer workbench session queue is full', 429)
  console.error('[workbench-session-create-failed]', error)
  return apiError('Unable to create workbench session', 500)
}

/**
 * Creates a real interactive shell session (Phase 3b) — separate from the
 * allowlisted one-shot `shell.exec` workbench jobs. Body is optional:
 * `{ cols?, rows?, cwd? }`. The shell binary is always server-chosen from
 * the linked device's registered platform (see `resolveWorkbenchSessionShell`)
 * — a client can never request a specific shell/argv.
 */
export async function handleCreateWorkbenchSession(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  dependencies: CreateDependencies = { authorize: authorizeWorkbenchConversation, create: createWorkbenchSession },
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const dimensions = sanitizeWorkbenchSessionDimensions(body.cols, body.rows)
    if (!dimensions) return apiError('cols/rows must be numbers between 1 and 300', 400)
    const cwd = sanitizeWorkbenchSessionCwd(body.cwd)
    if (cwd === null) return apiError('cwd must be a safe relative path', 400)

    const authorization = await dependencies.authorize(user, conversationId)
    if (user.role !== 'admin' && user.role !== 'client') return apiError('Forbidden', 403)
    const session = await dependencies.create({
      conversationId: authorization.conversation.id,
      orgId: authorization.conversation.orgId,
      actorUserId: user.uid,
      actorRole: user.role,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      workspaceId: authorization.binding.workspaceId,
      mappingId: authorization.binding.mappingId,
      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
      ...(authorization.projectReplicaId ? { projectReplicaId: authorization.projectReplicaId } : {}),
      ...(authorization.rootBindingId ? { rootBindingId: authorization.rootBindingId } : {}),
      relativeFolder: authorization.relativeFolder,
      shell: resolveWorkbenchSessionShell(authorization.binding.platform),
      cols: dimensions.cols,
      rows: dimensions.rows,
      cwd,
    })
    return apiSuccess(publicWorkbenchSession(session), 202)
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Context).params
  return handleCreateWorkbenchSession(request, user, convId)
})

type ListDependencies = {
  authorize: (user: ApiUser, conversationId: string) => Promise<RouteAuthorization>
  list: (conversationId: string) => Promise<Awaited<ReturnType<typeof listActiveSessionsForConversation>>>
}

export async function handleListWorkbenchSessions(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  dependencies: ListDependencies = { authorize: authorizeWorkbenchConversation, list: listActiveSessionsForConversation },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    if (user.role !== 'admin' && user.role !== 'client') return apiError('Forbidden', 403)
    // Return only this user's own, context-bound, still-active sessions so the
    // client can rehydrate the terminal panel after a tab switch/remount. The
    // store already filters terminal statuses; ownership is narrowed here so a
    // list request never leaks another actor's or device binding's sessions.
    const owned = (await dependencies.list(conversationId))
      .filter((session) => isWorkbenchSessionOwnedByContext(session, user, conversationId, authorization))
      .map(publicWorkbenchSession)
    return apiSuccess(owned)
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    console.error('[workbench-session-list-failed]', error)
    return apiError('Unable to list workbench sessions', 500)
  }
}

const listWorkbenchSessionsHandler = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Context).params
  return handleListWorkbenchSessions(request, user, convId)
})

export const GET = (request: NextRequest, context?: unknown) =>
  runWithFirestoreReadAudit(
    'api/v1/conversations/:id/workbench/sessions:list',
    () => listWorkbenchSessionsHandler(request, context),
    { logEveryRun: true },
  )
