import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_BROKER_JOB_COLLECTION } from '@/lib/workspace-os/broker'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const doc = await adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc(id).get()
  if (!doc.exists) return apiError('Workspace broker job not found', 404)
  const job = { id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string; orgId?: string }
  const resolved = resolveOrgId(req, user)
  const jobOrgId = typeof job.orgId === 'string' ? job.orgId : null
  const accessError = orgAccessError(user, resolved.orgId ?? jobOrgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== jobOrgId) return apiError('Forbidden', 403)
  return apiSuccess(job)
})
