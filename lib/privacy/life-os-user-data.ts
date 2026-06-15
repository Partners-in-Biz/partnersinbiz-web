export interface LifeOsUserDataRecord {
  id: string
  data: Record<string, unknown>
}

export interface LifeOsUserDataStore {
  listCollection(collection: string): Promise<LifeOsUserDataRecord[]>
  deleteRecord(collection: string, id: string): Promise<void>
  updateRecord(collection: string, id: string, patch: Record<string, unknown>): Promise<void>
  createRecord(collection: string, data: Record<string, unknown>): Promise<string>
}

export interface LifeOsUserScope {
  orgId: string
  ownerUid: string
  actorUid?: string
  requestedAt?: string
}

export interface LifeOsFamilyExport {
  label: string
  collections: string[]
  count: number
  records: Array<{ id: string; collection: string; data: Record<string, unknown> }>
}

export interface LifeOsUserExport {
  orgId: string
  ownerUid: string
  exportedAt: string
  lifeOs: {
    schemaVersion: '2026-06-15.life-os-user-export.v1'
    families: Record<string, LifeOsFamilyExport>
  }
  metrics?: never
}

export interface LifeOsDeleteReport {
  orgId: string
  ownerUid: string
  requestedAt: string
  auditId: string
  totals: {
    deleted: number
    anonymised: number
    skipped: number
  }
  collections: Record<string, { deleted: number; anonymised: number; skipped: number }>
}

type LifeOsUserDataFamily = {
  key: string
  label: string
  collections: string[]
  retention: 'purge' | 'anonymise'
}

export const LIFE_OS_USER_DATA_FAMILIES: LifeOsUserDataFamily[] = [
  { key: 'profile', label: 'Profile and first-run baseline', collections: ['life_os_profiles'], retention: 'anonymise' },
  { key: 'goals', label: 'Goals', collections: ['life_os_goals'], retention: 'purge' },
  { key: 'plans', label: 'Plans and actions', collections: ['life_os_plans', 'life_os_actions'], retention: 'purge' },
  { key: 'habits', label: 'Habits', collections: ['life_os_habits'], retention: 'purge' },
  { key: 'habitCheckIns', label: 'Habit check-ins', collections: ['life_os_habit_check_ins'], retention: 'purge' },
  { key: 'reflections', label: 'Daily reflections and check-ins', collections: ['life_os_check_ins'], retention: 'purge' },
  { key: 'reviews', label: 'Weekly reviews', collections: ['life_os_reviews'], retention: 'purge' },
  { key: 'coachContext', label: 'Coach context', collections: ['life_os_coach_contexts'], retention: 'purge' },
  { key: 'coachInteractions', label: 'Coach interactions', collections: ['life_os_coach_interactions'], retention: 'purge' },
  { key: 'coachConversations', label: 'Coach conversations', collections: ['hermes_conversations', 'hermes_conversation_messages'], retention: 'anonymise' },
  { key: 'experiments', label: 'Experiments', collections: ['life_os_experiments'], retention: 'purge' },
  { key: 'reminderSettings', label: 'Reminder settings', collections: ['life_os_reminder_preferences'], retention: 'purge' },
  { key: 'reminders', label: 'Reminder records', collections: ['life_os_reminders'], retention: 'purge' },
  { key: 'dashboardSignals', label: 'Dashboard signals', collections: ['life_os_dashboard_signals'], retention: 'purge' },
  { key: 'exportDeleteAudits', label: 'Export/delete audit records', collections: ['life_os_privacy_audits'], retention: 'anonymise' },
] as const

const ALL_LIFE_OS_COLLECTIONS = Array.from(new Set(LIFE_OS_USER_DATA_FAMILIES.flatMap((family) => family.collections)))
const ANONYMISE_COLLECTIONS = new Set(
  LIFE_OS_USER_DATA_FAMILIES
    .filter((family) => family.retention === 'anonymise')
    .flatMap((family) => family.collections)
    .filter((collection) => collection !== 'hermes_conversation_messages'),
)
const AUDIT_COLLECTION = 'life_os_privacy_audits'

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function assertScope(scope: LifeOsUserScope) {
  if (!scope.orgId?.trim()) throw new Error('orgId is required')
  if (!scope.ownerUid?.trim()) throw new Error('ownerUid is required')
}

function recordOwner(data: Record<string, unknown>) {
  return cleanString(data.ownerUid) || cleanString(data.ownerId) || cleanString(data.subjectUid)
}

function isScopedRecord(record: LifeOsUserDataRecord, orgId: string, ownerUid: string) {
  const data = record.data
  if (cleanString(data.orgId) !== orgId) return false
  if (recordOwner(data) === ownerUid) return true
  const participants = Array.isArray(data.participantUids) ? data.participantUids : []
  return participants.some((participant) => participant === ownerUid)
}

function nowIso(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (!Number.isFinite(date.getTime())) throw new Error('requestedAt must be a valid date')
  return date.toISOString()
}

async function listScopedByCollection(store: LifeOsUserDataStore, orgId: string, ownerUid: string) {
  const out: Record<string, LifeOsUserDataRecord[]> = {}
  for (const collection of ALL_LIFE_OS_COLLECTIONS) {
    const records = await store.listCollection(collection)
    out[collection] = records.filter((record) => isScopedRecord(record, orgId, ownerUid))
  }
  return out
}

function auditBody(scope: Required<Pick<LifeOsUserScope, 'orgId' | 'ownerUid'>> & { actorUid?: string; requestedAt: string }, action: string, extra: Record<string, unknown> = {}) {
  return {
    orgId: scope.orgId,
    ownerUid: scope.ownerUid,
    actorUid: scope.actorUid ?? scope.ownerUid,
    action,
    requestedAt: scope.requestedAt,
    sensitivePayloadStored: false,
    ...extra,
  }
}

function counts() {
  return { deleted: 0, anonymised: 0, skipped: 0 }
}

function anonymisePatch(collection: string, requestedAt: string) {
  const common = {
    anonymised: true,
    anonymisedAt: requestedAt,
    anonymisedReason: 'owner-requested-delete',
    ownerUid: null,
    ownerId: null,
    subjectUid: null,
  }
  if (collection === 'hermes_conversations') {
    return {
      ...common,
      title: 'Anonymised Life OS conversation',
      lastMessagePreview: '',
      participantUids: [],
      archived: true,
    }
  }
  if (collection === AUDIT_COLLECTION) {
    return {
      ...common,
      action: 'anonymised_audit_record',
      details: null,
      payload: null,
      body: null,
    }
  }
  return {
    ...common,
    displayName: null,
    name: null,
    email: null,
    phone: null,
    firstRun: null,
    values: [],
    lifeDomains: [],
    constraints: [],
    goals: [],
    baseline: null,
    privacy: null,
    onboardingAnswers: null,
  }
}

export async function buildLifeOsExport(store: LifeOsUserDataStore, scope: LifeOsUserScope): Promise<LifeOsUserExport> {
  assertScope(scope)
  const orgId = scope.orgId.trim()
  const ownerUid = scope.ownerUid.trim()
  const exportedAt = nowIso(scope.requestedAt)
  const byCollection = await listScopedByCollection(store, orgId, ownerUid)
  const families: Record<string, LifeOsFamilyExport> = {}

  for (const family of LIFE_OS_USER_DATA_FAMILIES) {
    const records = family.collections.flatMap((collection) =>
      (byCollection[collection] ?? []).map((record) => ({ id: record.id, collection, data: record.data })),
    )
    families[family.key] = {
      label: family.label,
      collections: family.collections,
      count: records.length,
      records,
    }
  }

  await store.createRecord(AUDIT_COLLECTION, auditBody({ orgId, ownerUid, actorUid: scope.actorUid, requestedAt: exportedAt }, 'export_requested', {
    format: 'json',
    families: LIFE_OS_USER_DATA_FAMILIES.map((family) => family.key),
  }))

  return {
    orgId,
    ownerUid,
    exportedAt,
    lifeOs: {
      schemaVersion: '2026-06-15.life-os-user-export.v1',
      families,
    },
  }
}

export async function requestLifeOsDelete(store: LifeOsUserDataStore, scope: LifeOsUserScope) {
  assertScope(scope)
  const orgId = scope.orgId.trim()
  const ownerUid = scope.ownerUid.trim()
  const requestedAt = nowIso(scope.requestedAt)
  const auditId = await store.createRecord(AUDIT_COLLECTION, auditBody({ orgId, ownerUid, actorUid: scope.actorUid, requestedAt }, 'delete_requested'))
  await store.updateRecord('life_os_profiles', `${orgId}_${ownerUid}`, {
    deletionRequestedAt: requestedAt,
    deletionRequestAuditId: auditId,
    updatedAt: requestedAt,
  }).catch(() => undefined)
  return { orgId, ownerUid, requestedAt, auditId }
}

export async function deleteOrAnonymiseLifeOsUserData(store: LifeOsUserDataStore, scope: LifeOsUserScope): Promise<LifeOsDeleteReport> {
  assertScope(scope)
  const orgId = scope.orgId.trim()
  const ownerUid = scope.ownerUid.trim()
  const requestedAt = nowIso(scope.requestedAt)
  const byCollection = await listScopedByCollection(store, orgId, ownerUid)
  const report: LifeOsDeleteReport = {
    orgId,
    ownerUid,
    requestedAt,
    auditId: '',
    totals: counts(),
    collections: {},
  }

  for (const collection of ALL_LIFE_OS_COLLECTIONS) {
    const collectionCounts = counts()
    report.collections[collection] = collectionCounts
    for (const record of byCollection[collection] ?? []) {
      if (collection === AUDIT_COLLECTION || ANONYMISE_COLLECTIONS.has(collection)) {
        await store.updateRecord(collection, record.id, anonymisePatch(collection, requestedAt))
        collectionCounts.anonymised += 1
        report.totals.anonymised += 1
      } else {
        await store.deleteRecord(collection, record.id)
        collectionCounts.deleted += 1
        report.totals.deleted += 1
      }
    }
  }

  report.auditId = await store.createRecord(AUDIT_COLLECTION, auditBody({ orgId, ownerUid, actorUid: scope.actorUid, requestedAt }, 'delete_completed', {
    totals: report.totals,
    collections: Object.fromEntries(Object.entries(report.collections).map(([collection, value]) => [collection, { ...value }])),
  }))

  return report
}
