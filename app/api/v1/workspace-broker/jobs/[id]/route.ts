import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
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

export const PATCH = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Workspace broker job not found', 404)

  const job = { id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string; orgId?: string; output?: Record<string, unknown> }
  const resolved = resolveOrgId(req, user)
  const jobOrgId = typeof job.orgId === 'string' ? job.orgId : null
  const accessError = orgAccessError(user, resolved.orgId ?? jobOrgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== jobOrgId) return apiError('Forbidden', 403)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  if (action !== 'approve' && action !== 'reject') return apiError('Invalid workspace broker job action', 400)

  const nextStatus = action === 'approve' ? 'queued' : 'cancelled'
  const approvalStatus = action === 'approve' ? 'approved' : 'rejected'
  const output = { ...(job.output ?? {}), googleMutationPerformed: false }
  const approvalEvidence = {
    ...((job.approvalEvidence && typeof job.approvalEvidence === 'object') ? job.approvalEvidence as Record<string, unknown> : {}),
    status: approvalStatus,
    decidedBy: user.uid,
    decidedAt: FieldValue.serverTimestamp(),
  }
  const update = {
    status: nextStatus,
    approvalStatus,
    approvalSatisfied: action === 'approve',
    approvalEvidence,
    approvalDecidedBy: user.uid,
    approvalDecidedAt: FieldValue.serverTimestamp(),
    output,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await ref.update(update)
  return apiSuccess({ id, ...update, updatedAt: new Date().toISOString(), approvalDecidedAt: new Date().toISOString() })
})
