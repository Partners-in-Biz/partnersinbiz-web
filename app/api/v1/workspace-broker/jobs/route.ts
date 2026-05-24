import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_BROKER_JOB_COLLECTION } from '@/lib/workspace-os/broker'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const snapshot = await adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).where('orgId', '==', orgId).get()
  const status = searchParams.get('status')
  const operation = searchParams.get('operation')
  const artifactId = searchParams.get('artifactId')
  const jobs = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string; status?: string; operation?: string; input?: Record<string, unknown> }))
    .filter((job) => !status || job.status === status)
    .filter((job) => !operation || job.operation === operation)
    .filter((job) => !artifactId || (job.input as Record<string, unknown> | undefined)?.artifactId === artifactId)
  return apiSuccess(jobs)
})
