import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import { enqueueWorkbenchJob, type EnqueueWorkbenchJobInput } from '@/lib/messages/workbench/job-store'
import { parseWorkbenchOperation, publicWorkbenchJob } from '@/lib/messages/workbench/jobs'
import { linkedRuntimeUpdateRequired } from '@/lib/linked-computers/runtime-targets'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string }> }
type RouteAuthorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface CreateDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<RouteAuthorization>
  enqueue: (input: EnqueueWorkbenchJobInput) => Promise<Awaited<ReturnType<typeof enqueueWorkbenchJob>>>
}

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message === 'workbench: invalid operation') return apiError('Invalid workbench operation', 400)
  if (message.includes('idempotency key reused')) return apiError('Idempotency key was already used for another workbench operation', 409)
  if (message.includes('queue full')) return apiError('Computer workbench queue is full', 429)
  console.error('[workbench-job-create-failed]', error)
  return apiError('Unable to create workbench job', 500)
}

export async function handleCreateWorkbenchJob(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  dependencies: CreateDependencies = { authorize: authorizeWorkbenchConversation, enqueue: enqueueWorkbenchJob },
): Promise<Response> {
  try {
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return apiError('A valid Idempotency-Key header is required', 400)
    }
    const body = await request.json().catch(() => null) as { operation?: unknown } | null
    const operation = parseWorkbenchOperation(body?.operation)
    const authorization = await dependencies.authorize(user, conversationId)
    if (operation.kind === 'fs.search' && linkedRuntimeUpdateRequired(authorization.binding.runtimeVersion, '1.1.10')) {
      return apiError('Computer runtime update required for linked file search (minimum 1.1.10)', 409)
    }
    if (user.role !== 'admin' && user.role !== 'client') return apiError('Forbidden', 403)
    const job = await dependencies.enqueue({
      idempotencyKey,
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
      kind: operation.kind,
      operation,
    })
    return apiSuccess(publicWorkbenchJob(job), 202)
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Context).params
  return handleCreateWorkbenchJob(request, user, convId)
})
