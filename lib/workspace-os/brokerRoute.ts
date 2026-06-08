import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { actorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { actorRole, orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_ARTIFACT_EVENT_COLLECTION, WORKSPACE_BROKER_JOB_COLLECTION, type WorkspaceBrokerOperation, buildWorkspaceBrokerJobInput, evaluateWorkspaceBrokerApproval } from '@/lib/workspace-os/broker'
import { assertWorkspaceBrokerCreationGate, brokerGateStatus } from '@/lib/workspace-os/brokerGates'

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableNormalize(item)]),
  )
}

function workspaceBrokerRequestFingerprint(input: { orgId: string; operation: WorkspaceBrokerOperation; payload: Record<string, unknown> }): string {
  return createHash('sha256').update(JSON.stringify(stableNormalize(input))).digest('hex')
}

export async function createBrokerJob(req: NextRequest, user: ApiUser, operation: WorkspaceBrokerOperation, extraInput: Record<string, unknown> = {}) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const resolved = resolveOrgId(req, user, body)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const payload = { ...body, ...extraInput }
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || null
  const requestFingerprint = idempotencyKey ? workspaceBrokerRequestFingerprint({ orgId, operation, payload }) : null

  if (idempotencyKey) {
    try {
      const existing = await adminDb
        .collection(WORKSPACE_BROKER_JOB_COLLECTION)
        .where('orgId', '==', orgId)
        .where('idempotencyKey', '==', idempotencyKey)
        .limit(1)
        .get()
      const existingDoc = existing?.docs?.[0]
      if (existingDoc) {
        const existingJob = existingDoc.data() as Record<string, unknown>
        if (existingJob.operation !== operation || (typeof existingJob.requestFingerprint === 'string' && existingJob.requestFingerprint !== requestFingerprint)) {
          return apiError('Idempotency key was already used for a different Workspace broker request', 409)
        }
        const output = existingJob.output && typeof existingJob.output === 'object' && !Array.isArray(existingJob.output) ? existingJob.output as Record<string, unknown> : {}
        return apiSuccess({
          id: existingDoc.id,
          approvalRequired: existingJob.approvalRequired === true,
          requiredCapability: existingJob.requiredCapability,
          riskLevel: existingJob.riskLevel,
          status: existingJob.status,
          googleMutationPerformed: output.googleMutationPerformed === true,
        }, 200)
      }
    } catch {
      return apiError('Could not enforce Workspace broker idempotency', 500)
    }
  }

  const job = buildWorkspaceBrokerJobInput({
    orgId,
    operation,
    requestedBy: user.uid,
    createdByType: user.role === 'ai' ? 'agent' : user.role,
    agentId: user.agentId,
    connectionId: typeof payload.connectionId === 'string' ? payload.connectionId : null,
    approvalGateTaskId: null,
    approvalStatus: null,
    idempotencyKey,
    requestFingerprint,
    input: payload,
  })
  const decision = evaluateWorkspaceBrokerApproval({ operation, visibility: typeof payload.visibility === 'string' ? payload.visibility : null, approvalStatus: job.approvalStatus, approvalGateTaskId: job.approvalGateTaskId })
  try {
    await assertWorkspaceBrokerCreationGate({
      user,
      orgId,
      operation,
      connectionId: job.connectionId,
      requiredCapability: decision.requiredCapability,
    })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Workspace broker creation gate failed', brokerGateStatus(error))
  }
  const jobRef = adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc()
  const eventRef = adminDb.collection(WORKSPACE_ARTIFACT_EVENT_COLLECTION).doc()
  const batch = adminDb.batch()
  batch.set(jobRef, {
    ...job,
    ...actorFrom(user),
    output: { googleMutationPerformed: false, resultArtifactIds: [], resultArtifactUrls: [] },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  batch.set(eventRef, {
    orgId,
    brokerJobId: jobRef.id,
    operation,
    eventType: 'broker_job_queued',
    status: job.status,
    resultStatus: decision.approvalRequired && !decision.approvalSatisfied ? 'blocked' : 'queued',
    actor: { id: user.uid, role: user.role, agentId: user.agentId ?? null },
    approvalGateTaskId: job.approvalGateTaskId,
    source: job.targetResource,
    safeMetadata: {
      approvalRequired: decision.approvalRequired,
      requiredCapability: job.requiredCapability,
      riskLevel: job.riskLevel,
      googleMutationPerformed: false,
    },
    createdAt: FieldValue.serverTimestamp(),
  })
  try {
    await batch.commit()
  } catch {
    return apiError('Could not persist Workspace broker audit event', 500)
  }
  logActivity({ orgId, type: 'workspace_broker_job_created', actorId: user.uid, actorName: user.uid, actorRole: actorRole(user), description: `Queued Workspace broker job: ${operation}`, entityId: jobRef.id, entityType: 'workspace_broker_job', entityTitle: operation }).catch(() => {})
  return apiSuccess({ id: jobRef.id, approvalRequired: decision.approvalRequired, requiredCapability: job.requiredCapability, riskLevel: job.riskLevel, status: job.status, googleMutationPerformed: false }, decision.approvalRequired && !decision.approvalSatisfied ? 202 : 201)
}

export async function rejectGoogleMutation(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  if (body.externalShare === true || body.deleteFromGoogle === true) return apiError('Google share/delete mutations are not enabled in this MVP', 403)
  return null
}
