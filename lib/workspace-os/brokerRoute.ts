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
import { assertNoRawSecrets } from '@/lib/workspace-os/common'

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

function workspaceBrokerIdempotencyDocId(orgId: string, idempotencyKey: string): string {
  return `idem_${createHash('sha256').update(`${orgId}\0${idempotencyKey}`).digest('hex')}`
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  return record.code === 6 || record.code === 'already-exists' || record.code === 'ALREADY_EXISTS'
}

function brokerReplayResponse(id: string, existingJob: Record<string, unknown>, operation: WorkspaceBrokerOperation, requestFingerprint: string | null) {
  if (existingJob.operation !== operation || typeof existingJob.requestFingerprint !== 'string' || existingJob.requestFingerprint !== requestFingerprint) {
    return apiError('Idempotency key was already used for a different Workspace broker request', 409)
  }
  const output = existingJob.output && typeof existingJob.output === 'object' && !Array.isArray(existingJob.output) ? existingJob.output as Record<string, unknown> : {}
  return apiSuccess({
    id,
    approvalRequired: existingJob.approvalRequired === true,
    requiredCapability: existingJob.requiredCapability,
    riskLevel: existingJob.riskLevel,
    status: existingJob.status,
    googleMutationPerformed: output.googleMutationPerformed === true,
  }, 200)
}

export async function createBrokerJob(req: NextRequest, user: ApiUser, operation: WorkspaceBrokerOperation, extraInput: Record<string, unknown> = {}) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const payload = { ...body, ...extraInput }
  const resolved = resolveOrgId(req, user, payload)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch, resolved)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  try {
    assertNoRawSecrets(payload)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'raw secrets are not allowed in workspace registry payload', 400)
  }
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
        return brokerReplayResponse(existingDoc.id, existingDoc.data() as Record<string, unknown>, operation, requestFingerprint)
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
  const idempotencyDocId = idempotencyKey ? workspaceBrokerIdempotencyDocId(orgId, idempotencyKey) : null
  const jobRef = idempotencyDocId
    ? adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc(idempotencyDocId)
    : adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc()
  const eventRef = idempotencyDocId
    ? adminDb.collection(WORKSPACE_ARTIFACT_EVENT_COLLECTION).doc(`${idempotencyDocId}_broker_job_queued`)
    : adminDb.collection(WORKSPACE_ARTIFACT_EVENT_COLLECTION).doc()
  const batch = adminDb.batch()
  const jobData = {
    ...job,
    ...actorFrom(user),
    output: { googleMutationPerformed: false, resultArtifactIds: [], resultArtifactUrls: [] },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  const eventData = {
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
  }
  if (idempotencyKey) {
    batch.create(jobRef, jobData)
    batch.create(eventRef, eventData)
  } else {
    batch.set(jobRef, jobData)
    batch.set(eventRef, eventData)
  }
  try {
    await batch.commit()
  } catch (error) {
    if (idempotencyKey && isAlreadyExistsError(error)) {
      const existing = await jobRef.get().catch(() => null)
      if (existing?.exists) {
        return brokerReplayResponse(existing.id, existing.data() as Record<string, unknown>, operation, requestFingerprint)
      }
      return apiError('Could not enforce Workspace broker idempotency', 500)
    }
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
