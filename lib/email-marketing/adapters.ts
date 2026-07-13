import {
  EMAIL_PROGRAM_RECORD_TYPE,
  EMAIL_PROGRAM_SCHEMA_VERSION,
  type EmailProgram,
  type EmailProgramActorRef,
  type EmailProgramKind,
  type EmailProgramSourceCollection,
  type EmailProgramStatus,
} from './types'

export type LegacyRecord = Record<string, unknown> & { id?: string; orgId?: string }

export type EmailProgramAdapterErrorCode =
  | 'invalid_record'
  | 'ambiguous_record'
  | 'not_email_program'
  | 'unsupported_channel'

export type EmailProgramAdapterResult =
  | { ok: true; program: EmailProgram }
  | {
      ok: false
      code: EmailProgramAdapterErrorCode
      source: { collection: EmailProgramSourceCollection; id: string; orgId: string }
      message: string
    }

const CONTENT_CAMPAIGN_MARKERS = ['clientId', 'clientType', 'research', 'brandIdentity', 'pillars', 'calendar', 'shareToken']
const EMAIL_CAMPAIGN_MARKERS = [
  'sequenceId', 'subject', 'previewText', 'preheader', 'emailDocument', 'fromDomainId',
  'fromName', 'fromLocal', 'segmentId', 'contactIds', 'tagIds', 'excludeTagIds',
]

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function actor(record: LegacyRecord, prefix: 'created' | 'updated'): EmailProgramActorRef {
  const id = stringValue(record[`${prefix}By`]) ?? 'legacy'
  const candidate = record[`${prefix}ByType`]
  const type = candidate === 'agent' || candidate === 'system' ? candidate : 'user'
  return { type, id }
}

function sourceError(
  collection: EmailProgramSourceCollection,
  record: LegacyRecord,
  code: EmailProgramAdapterErrorCode,
  message: string,
): EmailProgramAdapterResult {
  return {
    ok: false,
    code,
    source: {
      collection,
      id: stringValue(record.id) ?? '',
      orgId: stringValue(record.orgId) ?? '',
    },
    message,
  }
}

function requireIdentity(
  collection: EmailProgramSourceCollection,
  record: LegacyRecord,
): EmailProgramAdapterResult | null {
  if (!stringValue(record.id) || !stringValue(record.orgId)) {
    return sourceError(collection, record, 'invalid_record', 'Record must have a non-empty id and orgId')
  }
  return null
}

function normalizeStatus(value: unknown, collection: EmailProgramSourceCollection): EmailProgramStatus {
  const status = stringValue(value) ?? 'draft'
  if (status === 'sending') return 'active'
  if (status === 'sent' || status === 'archived') return 'completed'
  if (status === 'canceled') return 'cancelled'
  if (status === 'pending_approval') return 'in_review'
  const supported: EmailProgramStatus[] = [
    'draft', 'in_review', 'approved', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'failed',
  ]
  if (supported.includes(status as EmailProgramStatus)) return status as EmailProgramStatus
  // A content-only status must never make a record email-like. Explicit adapters
  // may still expose a safe draft representation for unknown historical states.
  return collection === 'campaigns' && status === 'shipping' ? 'active' : 'draft'
}

function baseProgram(
  collection: EmailProgramSourceCollection,
  record: LegacyRecord,
  kind: EmailProgramKind,
  overrides: Partial<EmailProgram> = {},
): EmailProgram {
  const id = stringValue(record.id)!
  const orgId = stringValue(record.orgId)!
  const createdBy = actor(record, 'created')
  return {
    id,
    orgId,
    recordType: EMAIL_PROGRAM_RECORD_TYPE,
    schemaVersion: EMAIL_PROGRAM_SCHEMA_VERSION,
    kind,
    status: normalizeStatus(record.status, collection),
    name: stringValue(record.name) ?? 'Untitled email program',
    description: stringValue(record.description) ?? '',
    contentVersionId: stringValue(record.contentVersionId),
    workflowVersionId: stringValue(record.workflowVersionId),
    audienceVersionId: stringValue(record.audienceVersionId),
    senderPolicyId: stringValue(record.senderPolicyId),
    replyPolicyId: stringValue(record.replyPolicyId),
    preferenceTopicId: stringValue(record.preferenceTopicId) ?? stringValue(record.topicId),
    approvalPolicy: { required: true },
    approvalState: { status: 'pending', approvedSnapshotId: null },
    legalBasisPolicy: null,
    schedulePolicy: null,
    frequencyPolicy: null,
    experimentPolicy: null,
    links: {},
    createdBy,
    updatedBy: stringValue(record.updatedBy) ? actor(record, 'updated') : createdBy,
    launchSnapshot: null,
    createdAt: (record.createdAt as EmailProgram['createdAt']) ?? null,
    updatedAt: (record.updatedAt as EmailProgram['updatedAt']) ?? null,
    source: { collection, id, legacy: record.recordType !== EMAIL_PROGRAM_RECORD_TYPE },
    ...overrides,
  } as EmailProgram
}

export function adaptContentCampaign(record: LegacyRecord): EmailProgramAdapterResult {
  const identityError = requireIdentity('campaigns', record)
  if (identityError) return identityError
  return sourceError('campaigns', record, 'not_email_program', 'Content campaign is not an email program')
}

function adaptCanonicalCampaign(record: LegacyRecord): EmailProgramAdapterResult {
  if (record.schemaVersion !== EMAIL_PROGRAM_SCHEMA_VERSION) {
    return sourceError('campaigns', record, 'invalid_record', 'Unsupported email program schemaVersion')
  }
  const kinds: EmailProgramKind[] = ['broadcast', 'newsletter', 'lifecycle', 'sales_sequence', 'transactional', 'rss']
  if (!kinds.includes(record.kind as EmailProgramKind)) {
    return sourceError('campaigns', record, 'invalid_record', 'Canonical email program kind is invalid')
  }
  const statuses: EmailProgramStatus[] = [
    'draft', 'in_review', 'approved', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'failed',
  ]
  if (!statuses.includes(record.status as EmailProgramStatus)) {
    return sourceError('campaigns', record, 'invalid_record', 'Canonical email program status is invalid')
  }
  return {
    ok: true,
    program: baseProgram('campaigns', record, record.kind as EmailProgramKind, {
      ...(record as Partial<EmailProgram>),
      id: stringValue(record.id)!,
      orgId: stringValue(record.orgId)!,
      recordType: EMAIL_PROGRAM_RECORD_TYPE,
      schemaVersion: EMAIL_PROGRAM_SCHEMA_VERSION,
      source: { collection: 'campaigns', id: stringValue(record.id)!, legacy: false },
    }),
  }
}

export function adaptCampaignRecord(record: LegacyRecord): EmailProgramAdapterResult {
  const identityError = requireIdentity('campaigns', record)
  if (identityError) return identityError

  if (record.recordType === 'content_campaign') {
    return adaptContentCampaign(record)
  }
  if (record.recordType === EMAIL_PROGRAM_RECORD_TYPE || record.recordType === 'email_campaign') {
    return record.recordType === EMAIL_PROGRAM_RECORD_TYPE
      ? adaptCanonicalCampaign(record)
      : adaptLegacyEmailCampaign(record)
  }
  if (record.recordType !== undefined) {
    return sourceError('campaigns', record, 'invalid_record', 'Unknown campaigns recordType')
  }

  const emailLike = EMAIL_CAMPAIGN_MARKERS.some((key) => record[key] !== undefined)
  const contentLike = CONTENT_CAMPAIGN_MARKERS.some((key) => record[key] !== undefined)
  if (emailLike && contentLike) {
    return sourceError('campaigns', record, 'ambiguous_record', 'Legacy campaigns record matches email and content shapes')
  }
  if (contentLike) {
    return sourceError('campaigns', record, 'not_email_program', 'Legacy content campaign is not an email program')
  }
  if (!emailLike) {
    return sourceError('campaigns', record, 'ambiguous_record', 'Legacy campaigns record cannot be classified safely')
  }
  return adaptLegacyEmailCampaign(record)
}

function adaptLegacyEmailCampaign(record: LegacyRecord): EmailProgramAdapterResult {
  const sequenceId = stringValue(record.sequenceId)
  const kind: EmailProgramKind = sequenceId ? 'lifecycle' : 'newsletter'
  return {
    ok: true,
    program: baseProgram('campaigns', record, kind, {
      contentVersionId: stringValue(record.contentVersionId) ?? stringValue(record.emailDocumentVersionId),
      workflowVersionId: sequenceId,
      audienceVersionId: stringValue(record.audienceVersionId),
    }),
  }
}

export function adaptBroadcast(record: LegacyRecord): EmailProgramAdapterResult {
  const identityError = requireIdentity('broadcasts', record)
  if (identityError) return identityError
  if (record.channel !== undefined && record.channel !== 'email') {
    return sourceError('broadcasts', record, 'unsupported_channel', 'Only email broadcasts are email programs')
  }
  const content = (record.content && typeof record.content === 'object' ? record.content : {}) as Record<string, unknown>
  const topicId = stringValue(record.topicId)
  return {
    ok: true,
    program: baseProgram('broadcasts', record, topicId === 'newsletter' ? 'newsletter' : 'broadcast', {
      contentVersionId: stringValue(record.contentVersionId) ?? stringValue(content.templateId),
      preferenceTopicId: topicId,
      schedulePolicy: record.scheduledFor ? { scheduledFor: record.scheduledFor as never } : null,
    }),
  }
}

export function adaptSequence(record: LegacyRecord): EmailProgramAdapterResult {
  const identityError = requireIdentity('sequences', record)
  if (identityError) return identityError
  const kind = record.programKind === 'sales_sequence' ? 'sales_sequence' : 'lifecycle'
  return {
    ok: true,
    program: baseProgram('sequences', record, kind, {
      workflowVersionId: stringValue(record.workflowVersionId) ?? stringValue(record.id),
    }),
  }
}

export function adaptCommunicationCampaign(record: LegacyRecord): EmailProgramAdapterResult {
  const identityError = requireIdentity('communication_campaigns', record)
  if (identityError) return identityError
  if (record.channel !== 'email') {
    return sourceError('communication_campaigns', record, 'unsupported_channel', 'Only email communications campaigns are email programs')
  }
  return {
    ok: true,
    program: baseProgram('communication_campaigns', record, 'broadcast', {
      contentVersionId: stringValue(record.contentVersionId) ?? stringValue(record.templateId),
      schedulePolicy: record.scheduledFor ? { scheduledFor: record.scheduledFor as never } : null,
    }),
  }
}

export function adaptLegacyRecord(
  collection: EmailProgramSourceCollection,
  record: LegacyRecord,
): EmailProgramAdapterResult {
  if (collection === 'campaigns') return adaptCampaignRecord(record)
  if (collection === 'broadcasts') return adaptBroadcast(record)
  if (collection === 'sequences') return adaptSequence(record)
  return adaptCommunicationCampaign(record)
}
