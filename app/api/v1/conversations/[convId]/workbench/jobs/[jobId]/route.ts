import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import { getWorkbenchJob } from '@/lib/messages/workbench/job-store'
import { publicWorkbenchJob, type WorkbenchJob } from '@/lib/messages/workbench/jobs'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; jobId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface GetDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (jobId: string) => Promise<WorkbenchJob | null>
}

export function workbenchBrowserBindingMatches(
  job: WorkbenchJob,
  user: ApiUser,
  conversationId: string,
  authorization: Authorization,
): boolean {
  return job.conversationId === conversationId
    && authorization.conversation.id === conversationId
    && job.orgId === authorization.conversation.orgId
    && job.actorUserId === user.uid
    && job.deviceId === authorization.binding.deviceId
    && job.runtimeTargetId === authorization.binding.runtimeTargetId
    && job.credentialVersion === authorization.binding.credentialVersion
    && job.workspaceId === authorization.binding.workspaceId
    && job.mappingId === authorization.binding.mappingId
    && (job.projectId ?? null) === authorization.projectId
    && (job.projectReplicaId ?? null) === (authorization.projectReplicaId ?? null)
    && job.relativeFolder === authorization.relativeFolder
}

export async function handleGetWorkbenchJob(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  jobId: string,
  dependencies: GetDependencies = { authorize: authorizeWorkbenchConversation, get: getWorkbenchJob },
): Promise<Response> {
  try {
    // Reauthorize the mutable conversation, project, grant and mapping before
    // reading the durable job. This also avoids revealing whether a foreign id exists.
    const authorization = await dependencies.authorize(user, conversationId)
    const job = await dependencies.get(jobId)
    if (!job || !workbenchBrowserBindingMatches(job, user, conversationId, authorization)) {
      return apiError('Workbench job not found', 404)
    }
    return apiSuccess(publicWorkbenchJob(job))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    console.error('[workbench-job-read-failed]', error)
    return apiError('Unable to read workbench job', 500)
  }
}

export const GET = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, jobId } = await (context as Context).params
  return handleGetWorkbenchJob(request, user, convId, jobId)
})
