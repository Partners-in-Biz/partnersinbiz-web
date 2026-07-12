import { createHash } from 'crypto'

type EmailApprovalResource = Record<string, unknown>

function timestampValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; toMillis?: () => number }
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString()
    if (typeof candidate.toMillis === 'function') return new Date(candidate.toMillis()).toISOString()
  }
  return value ?? null
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  }
  return value
}

export function emailApprovalSnapshot(resource: EmailApprovalResource) {
  return stable({
    content: resource.content ?? {
      subject: resource.subject ?? null,
      previewText: resource.previewText ?? null,
      emailDocument: resource.emailDocument ?? null,
      sequenceId: resource.sequenceId ?? null,
      steps: resource.steps ?? null,
    },
    audience: resource.audience ?? {
      audienceDefinition: resource.audienceDefinition ?? null,
      segmentId: resource.segmentId ?? null,
      tagId: resource.tagId ?? null,
      contactIds: resource.contactIds ?? null,
      exclusionContactIds: resource.exclusionContactIds ?? null,
    },
    sender: {
      senderPolicyId: resource.senderPolicyId ?? null,
      fromDomainId: resource.fromDomainId ?? null,
      fromName: resource.fromName ?? null,
      fromLocal: resource.fromLocal ?? null,
      replyTo: resource.replyTo ?? null,
      replyPolicyId: resource.replyPolicyId ?? null,
    },
    schedule: {
      scheduledFor: timestampValue(resource.scheduledFor ?? resource.scheduledAt ?? resource.startAt),
      audienceLocalDelivery: resource.audienceLocalDelivery ?? null,
      localDeliveryWindowHours: resource.localDeliveryWindowHours ?? null,
    },
  })
}

export function buildEmailApprovalSnapshotHash(resource: EmailApprovalResource): string {
  return createHash('sha256').update(JSON.stringify(emailApprovalSnapshot(resource))).digest('hex')
}

export function approvalSnapshotMatches(resource: EmailApprovalResource, expected: string | null | undefined): boolean {
  return !!expected && buildEmailApprovalSnapshotHash(resource) === expected
}
