export type LifeOsRetentionMode = 'dry-run' | 'commit'
export type LifeOsRetentionAction = 'purge' | 'anonymise'

export interface LifeOsRetentionRecord {
  id: string
  data: Record<string, unknown>
}

export interface LifeOsRetentionStore {
  listCollection(collection: string): Promise<LifeOsRetentionRecord[]>
  deleteRecord(collection: string, id: string): Promise<void>
  updateRecord(collection: string, id: string, patch: Record<string, unknown>): Promise<void>
}

export interface LifeOsRetentionOptions {
  orgId: string
  ownerUid: string
  mode?: LifeOsRetentionMode
  now?: string | Date
  approvalEvidence?: string
}

export interface LifeOsRetentionReport {
  mode: LifeOsRetentionMode
  scopedTo: { orgId: string; ownerUid: string }
  rules: typeof LIFE_OS_RETENTION_RULES
  requiresApprovalForCommit: true
  approvalEvidenceRecorded: boolean
  totals: RetentionCounts
  collections: Record<string, RetentionCounts>
}

interface RetentionCounts {
  purge: number
  anonymise: number
  skipped: number
}

interface Candidate {
  collection: string
  record: LifeOsRetentionRecord
  action: LifeOsRetentionAction
}

const DAY_MS = 24 * 60 * 60 * 1000

export const LIFE_OS_RETENTION_RULES = {
  deletionRequest: {
    graceDays: 30,
    reason: 'owner-requested-delete-after-privacy-grace-period',
    description:
      'After a verified export/delete request and 30-day grace period, personal Life OS working records are purged and profile/conversation shell records are anonymised so audit history can remain without sensitive content.',
  },
  operationalReminders: {
    purgeAfterDays: 90,
    statuses: ['sent', 'delivered', 'cancelled', 'failed'] as const,
    reason: 'short-lived-operational-reminder-expired',
    description:
      'Short-lived reminder delivery records are purged after they are no longer operationally necessary. Pending reminders are not touched by retention cleanup.',
  },
  commitSafety: {
    dryRunFirst: true,
    approvalEvidenceRequired: true,
    description:
      'The utility is dry-run-first. Commit mode requires explicit approval evidence and still scopes every candidate by orgId and ownerUid/ownerId before mutating.',
  },
} as const

const LIFE_OS_PURGE_COLLECTIONS = [
  'life_os_goals',
  'life_os_plans',
  'life_os_actions',
  'life_os_habits',
  'life_os_habit_check_ins',
  'life_os_check_ins',
  'life_os_reviews',
  'life_os_coach_contexts',
  'life_os_coach_interactions',
  'life_os_experiments',
  'life_os_reminder_preferences',
  'life_os_dashboard_signals',
  'hermes_conversation_messages',
] as const

const LIFE_OS_ANONYMISE_COLLECTIONS = [
  'life_os_profiles',
  'life_os_privacy_audits',
  'hermes_conversations',
] as const

const REMINDER_COLLECTION = 'life_os_reminders'
const ALL_COLLECTIONS = [...LIFE_OS_ANONYMISE_COLLECTIONS, ...LIFE_OS_PURGE_COLLECTIONS, REMINDER_COLLECTION] as const

function emptyCounts(): RetentionCounts {
  return { purge: 0, anonymise: 0, skipped: 0 }
}

function assertScope(options: LifeOsRetentionOptions) {
  if (!options.orgId?.trim()) throw new Error('orgId is required')
  if (!options.ownerUid?.trim()) throw new Error('ownerUid is required')
}

function asMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' || typeof value === 'number') {
    const millis = new Date(value).getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
    if (typeof candidate._seconds === 'number') return candidate._seconds * 1000
  }
  return null
}

function isOlderThan(value: unknown, nowMs: number, days: number) {
  const millis = asMillis(value)
  return millis !== null && nowMs - millis >= days * DAY_MS
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isScopedPersonalRecord(record: LifeOsRetentionRecord, orgId: string, ownerUid: string) {
  const data = record.data
  if (cleanString(data.orgId) !== orgId) return false

  const directOwner = cleanString(data.ownerUid) || cleanString(data.ownerId)
  if (directOwner === ownerUid) return true

  const participants = Array.isArray(data.participantUids) ? data.participantUids : []
  return participants.some((participant) => participant === ownerUid)
}

function hasEligibleDeletionRequest(records: LifeOsRetentionRecord[], orgId: string, ownerUid: string, nowMs: number) {
  return records.some((record) => (
    isScopedPersonalRecord(record, orgId, ownerUid)
    && isOlderThan(record.data.deletionRequestedAt, nowMs, LIFE_OS_RETENTION_RULES.deletionRequest.graceDays)
    && !record.data.anonymised
  ))
}

function isExpiredReminder(record: LifeOsRetentionRecord, nowMs: number) {
  const status = cleanString(record.data.status).toLowerCase()
  if (!LIFE_OS_RETENTION_RULES.operationalReminders.statuses.includes(status as never)) return false
  return [record.data.deliveredAt, record.data.completedAt, record.data.updatedAt, record.data.createdAt]
    .some((date) => isOlderThan(date, nowMs, LIFE_OS_RETENTION_RULES.operationalReminders.purgeAfterDays))
}

function profileAnonymisationPatch(nowIso: string, approvalEvidence?: string): Record<string, unknown> {
  return {
    displayName: null,
    name: null,
    email: null,
    phone: null,
    values: [],
    lifeDomains: [],
    constraints: [],
    goals: [],
    baseline: null,
    privacy: null,
    onboardingAnswers: null,
    anonymised: true,
    anonymisedAt: nowIso,
    anonymisedReason: LIFE_OS_RETENTION_RULES.deletionRequest.reason,
    retentionApprovalEvidence: approvalEvidence ?? null,
  }
}

function conversationAnonymisationPatch(nowIso: string, approvalEvidence?: string): Record<string, unknown> {
  return {
    title: 'Anonymised Life OS conversation',
    lastMessagePreview: '',
    participantUids: [],
    archived: true,
    anonymised: true,
    anonymisedAt: nowIso,
    anonymisedReason: LIFE_OS_RETENTION_RULES.deletionRequest.reason,
    retentionApprovalEvidence: approvalEvidence ?? null,
  }
}

function patchFor(collection: string, nowIso: string, approvalEvidence?: string) {
  if (collection === 'hermes_conversations') return conversationAnonymisationPatch(nowIso, approvalEvidence)
  return profileAnonymisationPatch(nowIso, approvalEvidence)
}

function addCount(report: LifeOsRetentionReport, collection: string, action: LifeOsRetentionAction) {
  report.collections[collection] ??= emptyCounts()
  report.collections[collection][action] += 1
  report.totals[action] += 1
}

export async function runLifeOsRetention(store: LifeOsRetentionStore, options: LifeOsRetentionOptions): Promise<LifeOsRetentionReport> {
  assertScope(options)
  const mode = options.mode ?? 'dry-run'
  const orgId = options.orgId.trim()
  const ownerUid = options.ownerUid.trim()
  const approvalEvidence = options.approvalEvidence?.trim()

  if (mode === 'commit' && !approvalEvidence) {
    throw new Error('approvalEvidence is required for commit mode')
  }

  const nowDate = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  const nowMs = nowDate.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date')
  const nowIso = nowDate.toISOString()

  const recordsByCollection: Record<string, LifeOsRetentionRecord[]> = {}
  for (const collection of ALL_COLLECTIONS) {
    recordsByCollection[collection] = await store.listCollection(collection)
  }

  const deletionEligible = hasEligibleDeletionRequest(recordsByCollection.life_os_profiles ?? [], orgId, ownerUid, nowMs)
  const candidates: Candidate[] = []

  if (deletionEligible) {
    for (const collection of LIFE_OS_ANONYMISE_COLLECTIONS) {
      for (const record of recordsByCollection[collection] ?? []) {
        const eligibleProfile = collection === 'life_os_profiles'
          && isOlderThan(record.data.deletionRequestedAt, nowMs, LIFE_OS_RETENTION_RULES.deletionRequest.graceDays)
        const eligibleConversation = collection === 'hermes_conversations'
        if (isScopedPersonalRecord(record, orgId, ownerUid) && !record.data.anonymised && (eligibleProfile || eligibleConversation)) {
          candidates.push({ collection, record, action: 'anonymise' })
        }
      }
    }

    for (const collection of LIFE_OS_PURGE_COLLECTIONS) {
      for (const record of recordsByCollection[collection] ?? []) {
        if (isScopedPersonalRecord(record, orgId, ownerUid)) {
          candidates.push({ collection, record, action: 'purge' })
        }
      }
    }
  }

  for (const record of recordsByCollection[REMINDER_COLLECTION] ?? []) {
    if (isScopedPersonalRecord(record, orgId, ownerUid) && isExpiredReminder(record, nowMs)) {
      candidates.push({ collection: REMINDER_COLLECTION, record, action: 'purge' })
    }
  }

  const report: LifeOsRetentionReport = {
    mode,
    scopedTo: { orgId, ownerUid },
    rules: LIFE_OS_RETENTION_RULES,
    requiresApprovalForCommit: true,
    approvalEvidenceRecorded: mode === 'commit',
    totals: emptyCounts(),
    collections: {},
  }

  for (const candidate of candidates) {
    addCount(report, candidate.collection, candidate.action)
    if (mode === 'commit') {
      if (candidate.action === 'purge') {
        await store.deleteRecord(candidate.collection, candidate.record.id)
      } else {
        await store.updateRecord(candidate.collection, candidate.record.id, patchFor(candidate.collection, nowIso, approvalEvidence))
      }
    }
  }

  return report
}
