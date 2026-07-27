import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeWorkbenchConversation, isWorkbenchJobOwnedByContext, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import { createWorkbenchPathContextReference } from '@/lib/messages/workbench/context-references'
import { getWorkbenchJob } from '@/lib/messages/workbench/job-store'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ convId: string }> }

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  try {
    const { convId } = await (context as Context).params
    const body = await request.json().catch(() => null) as { jobId?: unknown } | null
    const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''
    if (!jobId) return apiError('jobId is required', 400)
    const [authorization, job] = await Promise.all([
      authorizeWorkbenchConversation(user, convId),
      getWorkbenchJob(jobId),
    ])
    if (!job || !isWorkbenchJobOwnedByContext(job, user, convId, authorization)) {
      return apiError('Workbench search job not found', 404)
    }
    if (job.kind !== 'fs.search' || job.status !== 'completed' || !job.result || !('entries' in job.result)) {
      return apiError('Workbench search job is not complete', 409)
    }
    const entries = job.result.entries as Array<{ path: string; type: 'file' | 'directory'; size?: number }>
    const refs = entries.map((entry) => createWorkbenchPathContextReference(authorization, entry))
    return apiSuccess({ refs })
  } catch (error) {
    if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
    console.error('[workbench-context-reference-create-failed]', error)
    return apiError('Unable to create Workbench path references', 500)
  }
})
