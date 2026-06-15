import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_BROKER_JOB_COLLECTION, canExecuteWorkspaceBrokerJob, type WorkspaceBrokerJob } from '@/lib/workspace-os/broker'
import { cleanString } from '@/lib/workspace-os/common'
import { executeWorkspaceBrokerJob } from '@/lib/workspace-os/googleBrokerExecutor'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const doc = await adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc(id).get()
  if (!doc.exists) return apiError('Workspace broker job not found', 404)
  const job = { id: doc.id, ...(doc.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string; orgId?: string }
  const resolved = resolveOrgId(req, user)
  const jobOrgId = typeof job.orgId === 'string' ? job.orgId : null
  const accessError = orgAccessError(user, resolved.orgId ?? jobOrgId, resolved.mismatch, resolved)
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
  const accessError = orgAccessError(user, resolved.orgId ?? jobOrgId, resolved.mismatch, resolved)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== jobOrgId) return apiError('Forbidden', 403)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  if (action !== 'approve' && action !== 'reject' && action !== 'execute') return apiError('Invalid workspace broker job action', 400)

  if (action === 'execute') {
    const executionGate = canExecuteWorkspaceBrokerJob(job as Partial<WorkspaceBrokerJob>)
    if (!executionGate.ok) return apiError(executionGate.reason === 'approval_required' ? 'Workspace broker approval evidence is required before execution' : 'Workspace broker job is not ready for execution', executionGate.reason === 'approval_required' ? 403 : 409)

    await ref.update({ status: 'running', startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    try {
      const result = await executeWorkspaceBrokerJob({ ...(job as unknown as WorkspaceBrokerJob), id })
      const resultArtifactIds = result.artifactIds
      const resultArtifactUrls = result.artifactUrls
      const output = {
        ...(job.output ?? {}),
        ...result.output,
        googleMutationPerformed: result.googleMutationPerformed,
        providerResultIds: result.providerResultIds,
        artifactIds: resultArtifactIds,
        artifactUrls: resultArtifactUrls,
        resultArtifactIds,
        resultArtifactUrls,
      }
      const update = {
        status: 'done',
        output,
        resultArtifactIds,
        resultArtifactUrls,
        error: null,
        errors: [],
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      await ref.update(update)
      return apiSuccess({ id, status: 'done', googleMutationPerformed: result.googleMutationPerformed, artifactIds: resultArtifactIds, artifactUrls: resultArtifactUrls, providerResultIds: result.providerResultIds })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace broker execution failed'
      await ref.update({
        status: 'failed',
        error: message,
        errors: [message],
        output: { ...(job.output ?? {}), googleMutationPerformed: false },
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return apiError(message, 500)
    }
  }

  if (job.approvalRequired !== true) return apiError('Workspace broker job does not require approval', 400)
  if (job.status !== 'awaiting_approval') return apiError('Workspace broker job is not awaiting approval', 409)

  const approvalGateTaskId = cleanString(body.approvalGateTaskId) ?? cleanString(job.approvalGateTaskId)
  if (!approvalGateTaskId) return apiError('Workspace broker approval evidence is required', 400)

  const nextStatus = action === 'approve' ? 'queued' : 'cancelled'
  const approvalStatus = action === 'approve' ? 'approved' : 'rejected'
  const decidedAtIso = new Date().toISOString()
  const output = { ...(job.output ?? {}), googleMutationPerformed: false }
  const approvalEvidence = {
    ...((job.approvalEvidence && typeof job.approvalEvidence === 'object') ? job.approvalEvidence as Record<string, unknown> : {}),
    gateTaskId: approvalGateTaskId,
    status: approvalStatus,
    decidedBy: user.uid,
    decidedAt: decidedAtIso,
  }
  const update = {
    status: nextStatus,
    approvalStatus,
    approvalGateTaskId,
    approvalSatisfied: action === 'approve',
    approvalEvidence,
    approvalDecidedBy: user.uid,
    approvalDecidedAt: FieldValue.serverTimestamp(),
    approvedAt: action === 'approve' ? FieldValue.serverTimestamp() : null,
    output,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await ref.update(update)
  return apiSuccess({
    id,
    status: nextStatus,
    approvalStatus,
    approvalGateTaskId,
    approvalSatisfied: action === 'approve',
    approvalEvidence: { ...approvalEvidence, decidedAt: decidedAtIso },
    approvalDecidedBy: user.uid,
    approvalDecidedAt: decidedAtIso,
    approvedAt: action === 'approve' ? decidedAtIso : null,
    output,
    updatedAt: decidedAtIso,
  })
})
