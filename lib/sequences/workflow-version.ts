import { createHash } from 'crypto'
import type { Sequence, SequenceEnrollment, SequenceWorkflowSnapshot } from './types'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
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
  }
  const contentHash = createHash('sha256').update(JSON.stringify(canonicalize(runtime))).digest('hex')
  return {
    ...runtime,
    id: `${sequence.id}:v${options.version}:${contentHash.slice(0, 12)}`,
    version: options.version,
    contentHash,
    activatedAtIso: options.activatedAtIso,
  }
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
  enrollment: Pick<SequenceEnrollment, 'workflowVersionId' | 'workflowSnapshot'>,
): Sequence & { workflowVersionId?: string } {
  const snapshot = enrollment.workflowSnapshot
  if (!snapshot || (enrollment.workflowVersionId && snapshot.id !== enrollment.workflowVersionId)) return sequence
  if (snapshot.orgId !== sequence.orgId || snapshot.sequenceId !== sequence.id) return sequence
  return {
    ...sequence,
    steps: snapshot.steps,
    goals: snapshot.goals,
    topicId: snapshot.topicId,
    quietHours: snapshot.quietHours,
    reentryPolicy: snapshot.reentryPolicy,
    maxActiveEnrollments: snapshot.maxActiveEnrollments,
    workflowVersionId: snapshot.id,
  }
}
