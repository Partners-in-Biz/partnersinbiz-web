import { createHash } from 'crypto'
import type { Sequence, SequenceEnrollment, SequenceWorkflowSnapshot } from './types'

export class SequenceWorkflowPinError extends Error {
  constructor(message: string) {
    super(`Invalid workflow pin: ${message}`)
    this.name = 'SequenceWorkflowPinError'
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString()
    if (typeof timestamp.toMillis === 'function') return new Date(timestamp.toMillis()).toISOString()
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const nested = (value as Record<string, unknown>)[key]
        if (nested !== undefined) result[key] = canonicalize(nested)
        return result
      }, {})
  }
  return value
}

export function buildWorkflowVersion(
  sequence: Sequence,
  options: { activatedAtIso: string; version: number },
): SequenceWorkflowSnapshot {
  const source = sequence as unknown as Record<string, unknown>
  const approvalResource = {
    id: sequence.id,
    orgId: sequence.orgId,
    createdBy: source.createdBy,
    createdByType: source.createdByType,
    approvalState: sequence.approvalState
      ? {
          status: sequence.approvalState.status,
          approvedBy: sequence.approvalState.approvedBy ?? null,
          approvedByType: sequence.approvalState.approvedByType ?? null,
          approvalTaskId: sequence.approvalState.approvalTaskId ?? null,
          approvedSnapshotHash: sequence.approvalState.approvedSnapshotHash ?? null,
        }
      : undefined,
    content: source.content,
    subject: source.subject,
    previewText: source.previewText,
    emailDocument: source.emailDocument,
    steps: sequence.steps,
    audience: source.audience,
    audienceDefinition: source.audienceDefinition,
    segmentId: source.segmentId,
    tagId: source.tagId,
    contactIds: source.contactIds,
    exclusionContactIds: source.exclusionContactIds,
    senderPolicyId: source.senderPolicyId,
    fromDomainId: source.fromDomainId,
    fromName: source.fromName,
    fromLocal: source.fromLocal,
    replyTo: source.replyTo,
    replyPolicyId: source.replyPolicyId,
    scheduledFor: source.scheduledFor,
    scheduledAt: source.scheduledAt,
    startAt: source.startAt,
    audienceLocalDelivery: source.audienceLocalDelivery,
    localDeliveryWindowHours: source.localDeliveryWindowHours,
  }
  const runtime = {
    schemaVersion: 1 as const,
    sequenceId: sequence.id,
    orgId: sequence.orgId,
    steps: sequence.steps,
    goals: sequence.goals ?? [],
    topicId: sequence.topicId?.trim() || 'newsletter',
    quietHours: sequence.quietHours,
    reentryPolicy: sequence.reentryPolicy,
    maxActiveEnrollments: sequence.maxActiveEnrollments,
    approvalResource,
  }
  const contentHash = workflowContentHash(runtime)
  return {
    ...runtime,
    id: `${sequence.id}:v${options.version}:${contentHash.slice(0, 12)}`,
    version: options.version,
    contentHash,
    activatedAtIso: options.activatedAtIso,
  }
}

function workflowHashPayload(snapshot: Pick<SequenceWorkflowSnapshot,
  'schemaVersion' | 'sequenceId' | 'orgId' | 'steps' | 'goals' | 'topicId' | 'quietHours' | 'reentryPolicy' | 'maxActiveEnrollments' | 'approvalResource'
>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schemaVersion: snapshot.schemaVersion,
    sequenceId: snapshot.sequenceId,
    orgId: snapshot.orgId,
    steps: snapshot.steps,
    goals: snapshot.goals,
    topicId: snapshot.topicId,
    quietHours: snapshot.quietHours,
    reentryPolicy: snapshot.reentryPolicy,
    maxActiveEnrollments: snapshot.maxActiveEnrollments,
  }
  // Schema-v1 snapshots created before approval binding did not contain this
  // field; omitting it preserves hash verification while still withholding
  // approval evidence from those legacy pins.
  if (snapshot.approvalResource !== undefined) payload.approvalResource = snapshot.approvalResource
  return payload
}

export function workflowContentHash(snapshot: Parameters<typeof workflowHashPayload>[0]): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(workflowHashPayload(snapshot)))).digest('hex')
}

export function buildActivationVersion(
  existing: Sequence,
  patch: Partial<Sequence>,
  activatedAtIso: string,
): SequenceWorkflowSnapshot {
  const merged = { ...existing, ...patch, id: existing.id, orgId: existing.orgId }
  return buildWorkflowVersion(merged, {
    activatedAtIso,
    version: Math.max(0, Math.floor(existing.activeWorkflowVersion ?? 0)) + 1,
  })
}

export function workflowEnrollmentFields(sequence: Pick<Sequence, 'activeWorkflowVersionId' | 'activeWorkflowVersion' | 'activeWorkflowSnapshot'>): Pick<
  SequenceEnrollment,
  'workflowVersionId' | 'workflowVersion' | 'workflowContentHash' | 'workflowSnapshot'
> | Record<string, never> {
  const snapshot = sequence.activeWorkflowSnapshot
  if (!snapshot || snapshot.id !== sequence.activeWorkflowVersionId) return {}
  return {
    workflowVersionId: snapshot.id,
    workflowVersion: snapshot.version,
    workflowContentHash: snapshot.contentHash,
    workflowSnapshot: snapshot,
  }
}

export function runtimeSequenceForEnrollment(
  sequence: Sequence,
  enrollment: Pick<SequenceEnrollment, 'workflowVersionId' | 'workflowVersion' | 'workflowContentHash' | 'workflowSnapshot'>,
): Sequence & { workflowVersionId?: string; workflowApprovalResource?: Record<string, unknown> } {
  const claimed = enrollment.workflowVersionId !== undefined || enrollment.workflowVersion !== undefined ||
    enrollment.workflowContentHash !== undefined || enrollment.workflowSnapshot !== undefined
  if (!claimed) return sequence
  const snapshot = enrollment.workflowSnapshot
  if (!snapshot || !enrollment.workflowVersionId || enrollment.workflowVersion === undefined || !enrollment.workflowContentHash) {
    throw new SequenceWorkflowPinError('claimed version is incomplete')
  }
  if (snapshot.schemaVersion !== 1) throw new SequenceWorkflowPinError('unsupported schema version')
  if (snapshot.id !== enrollment.workflowVersionId) throw new SequenceWorkflowPinError('snapshot id does not match enrollment')
  if (snapshot.version !== enrollment.workflowVersion) throw new SequenceWorkflowPinError('snapshot version does not match enrollment')
  if (snapshot.orgId !== sequence.orgId) throw new SequenceWorkflowPinError('snapshot organisation does not match sequence')
  if (snapshot.sequenceId !== sequence.id) throw new SequenceWorkflowPinError('snapshot sequence does not match enrollment')
  if (snapshot.contentHash !== enrollment.workflowContentHash) throw new SequenceWorkflowPinError('snapshot hash does not match enrollment')
  const recomputedHash = workflowContentHash(snapshot)
  if (recomputedHash !== snapshot.contentHash) throw new SequenceWorkflowPinError('snapshot content hash verification failed')
  const expectedId = `${snapshot.sequenceId}:v${snapshot.version}:${snapshot.contentHash.slice(0, 12)}`
  if (snapshot.id !== expectedId) throw new SequenceWorkflowPinError('snapshot id is not derived from verified content')
  const approvalResource = snapshot.approvalResource ?? {
    id: sequence.id,
    orgId: sequence.orgId,
    steps: snapshot.steps,
  }
  return {
    ...sequence,
    steps: snapshot.steps,
    goals: snapshot.goals,
    topicId: snapshot.topicId,
    quietHours: snapshot.quietHours,
    reentryPolicy: snapshot.reentryPolicy,
    maxActiveEnrollments: snapshot.maxActiveEnrollments,
    approvalState: approvalResource.approvalState as Sequence['approvalState'],
    workflowVersionId: snapshot.id,
    workflowApprovalResource: approvalResource,
  }
}

export function approvalResourceForSequenceRuntime(
  runtime: Sequence & { workflowVersionId?: string; workflowApprovalResource?: Record<string, unknown> },
): Record<string, unknown> {
  if (!runtime.workflowVersionId) return runtime as unknown as Record<string, unknown>
  if (!runtime.workflowApprovalResource) throw new SequenceWorkflowPinError('approval resource is missing')
  return runtime.workflowApprovalResource
}
