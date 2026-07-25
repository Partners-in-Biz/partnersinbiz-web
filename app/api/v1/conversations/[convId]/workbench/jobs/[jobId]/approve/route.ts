import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import {
  approveWorkbenchJob,
  getWorkbenchJob,
  type ApproveWorkbenchJobInput,
} from '@/lib/messages/workbench/job-store'
import { publicWorkbenchJob, type WorkbenchJob } from '@/lib/messages/workbench/jobs'
import { workbenchBrowserBindingMatches } from '../route'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string; jobId: string }> }
type Authorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface ApproveDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<Authorization>
  get: (jobId: string) => Promise<WorkbenchJob | null>
  approve: (input: ApproveWorkbenchJobInput) => Promise<WorkbenchJob>
}

export async function handleApproveWorkbenchJob(
  _request: NextRequest,
  user: ApiUser,
  conversationId: string,
  jobId: string,
  dependencies: ApproveDependencies = {
    authorize: authorizeWorkbenchConversation,
    get: getWorkbenchJob,
    approve: approveWorkbenchJob,
  },
): Promise<Response> {
  try {
    const authorization = await dependencies.authorize(user, conversationId)
    const job = await dependencies.get(jobId)
    if (!job || !workbenchBrowserBindingMatches(job, user, conversationId, authorization)) {
      return apiError('Workbench job not found', 404)
    }
    if (job.kind !== 'fs.write') return apiError('Only file writes require approval', 409)
    const approved = await dependencies.approve({
      jobId,
      approverUserId: user.uid,
      conversationId,
      orgId: authorization.conversation.orgId,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      workspaceId: authorization.binding.workspaceId,
      mappingId: authorization.binding.mappingId,
      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
      ...(authorization.projectReplicaId ? { projectReplicaId: authorization.projectReplicaId } : {}),
      relativeFolder: authorization.relativeFolder,
    })
    return apiSuccess(publicWorkbenchJob(approved))
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    const message = error instanceof Error ? error.message : ''
    if (message.includes('expired') || message.includes('not awaiting approval')) {
      return apiError('Workbench write is no longer awaiting approval', 409)
    }
    if (message.includes('binding mismatch') || message.includes('owner mismatch')) {
      return apiError('Workbench job not found', 404)
    }
    if (message.includes('queue full')) return apiError('Computer workbench queue is full', 429)
    console.error('[workbench-job-approval-failed]', error)
    return apiError('Unable to approve workbench job', 500)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId, jobId } = await (context as Context).params
  return handleApproveWorkbenchJob(request, user, convId, jobId)
})
