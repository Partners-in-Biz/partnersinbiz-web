import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { actorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { actorRole, orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_BROKER_JOB_COLLECTION, type WorkspaceBrokerOperation, buildWorkspaceBrokerJobInput, evaluateWorkspaceBrokerApproval } from '@/lib/workspace-os/broker'

export async function createBrokerJob(req: NextRequest, user: ApiUser, operation: WorkspaceBrokerOperation, extraInput: Record<string, unknown> = {}) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const resolved = resolveOrgId(req, user, body)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const payload = { ...body, ...extraInput }
  const job = buildWorkspaceBrokerJobInput({
    orgId,
    operation,
    requestedBy: user.uid,
    createdByType: user.role === 'ai' ? 'agent' : user.role,
    agentId: user.agentId,
    connectionId: typeof body.connectionId === 'string' ? body.connectionId : null,
    approvalGateTaskId: typeof body.approvalGateTaskId === 'string' ? body.approvalGateTaskId : null,
    approvalStatus: typeof body.approvalStatus === 'string' ? body.approvalStatus : null,
    idempotencyKey: req.headers.get('idempotency-key'),
    input: payload,
  })
  const decision = evaluateWorkspaceBrokerApproval({ operation, visibility: typeof payload.visibility === 'string' ? payload.visibility : null, approvalStatus: job.approvalStatus, approvalGateTaskId: job.approvalGateTaskId })
  const ref = await adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).add({
    ...job,
    ...actorFrom(user),
    output: { googleMutationPerformed: false, resultArtifactIds: [], resultArtifactUrls: [] },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  logActivity({ orgId, type: 'workspace_broker_job_created', actorId: user.uid, actorName: user.uid, actorRole: actorRole(user), description: `Queued Workspace broker job: ${operation}`, entityId: ref.id, entityType: 'workspace_broker_job', entityTitle: operation }).catch(() => {})
  return apiSuccess({ id: ref.id, approvalRequired: decision.approvalRequired, requiredCapability: job.requiredCapability, riskLevel: job.riskLevel, status: job.status, googleMutationPerformed: false }, decision.approvalRequired && !decision.approvalSatisfied ? 202 : 201)
}

export async function rejectGoogleMutation(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  if (body.externalShare === true || body.deleteFromGoogle === true) return apiError('Google share/delete mutations are not enabled in this MVP', 403)
  return null
}
