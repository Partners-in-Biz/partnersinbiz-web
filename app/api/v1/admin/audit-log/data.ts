import type { ApiUser } from '@/lib/api/types'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'

// Regex matching "sensitive" admin actions for suspicious-activity alerting.
export const SENSITIVE_ACTION_RE =
  /(delete|suspend|impersonat|billing|domain|key|credential|backup|restore|admin)/i

// Alerting thresholds.
const SENSITIVE_BURST_THRESHOLD = 5 // > N sensitive actions by one actor inside the window
const SENSITIVE_BURST_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const TOTAL_BURST_THRESHOLD = 30 // > N total actions by one actor inside the window

export type BasicDoc = Record<string, unknown> & { id: string }

export interface AuditRow {
  id: string
  orgId: string
  orgName: string
  type: string
  actorId: string
  actorName: string
  actorRole: string
  description: string
  entityType: string
  entityId: string
  oldValue: string
  newValue: string
  ip: string
  createdAtMs: number | null
  createdAt: string
  sensitive: boolean
}

export interface AuditAlert {
  id: string
  severity: 'high' | 'medium'
  actorId: string
  actorName: string
  kind: 'sensitive-burst' | 'volume-burst' | 'sensitive-action'
  count: number
  windowMinutes: number
  message: string
  sampleActions: string[]
}

export interface AuditFilters {
  actor?: string // matches actorId OR actorName (case-insensitive substring)
  action?: string // matches type (case-insensitive substring)
  from?: number | null // epoch ms inclusive
  to?: number | null // epoch ms inclusive
}

export interface AuditLogResult {
  rows: AuditRow[]
  alerts: AuditAlert[]
  total: number
  scanned: number
  scope: 'all' | 'restricted'
  actors: Array<{ id: string; name: string }>
  actions: string[]
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return fallback
}

// Coerce arbitrary stored values (objects, arrays, nested change records) into a
// short human-readable string for the old->new columns and CSV.
function coerceValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.map((item) => coerceValue(item)).filter(Boolean).join(', ')
  }
  if (typeof value === 'object') {
    // Firestore-ish typed value wrappers.
    const wrapper = value as Record<string, unknown>
    if (typeof wrapper.stringValue === 'string') return wrapper.stringValue
    if (typeof wrapper.integerValue !== 'undefined') return String(wrapper.integerValue)
    if (typeof wrapper.doubleValue !== 'undefined') return String(wrapper.doubleValue)
    if (typeof wrapper.booleanValue !== 'undefined') return String(wrapper.booleanValue)
    try {
      const json = JSON.stringify(value)
      return json && json.length > 240 ? `${json.slice(0, 237)}…` : json ?? ''
    } catch {
      return ''
    }
  }
  return ''
}

function timestampMs(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    const source = value as {
      toMillis?: () => number
      seconds?: number
      _seconds?: number
      toDate?: () => Date
    }
    try {
      if (typeof source.toMillis === 'function') return source.toMillis()
      if (typeof source.toDate === 'function') return source.toDate().getTime()
    } catch {
      return null
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function formatDateTime(ms: number | null): string {
  if (!ms) return ''
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

// Read old/new values defensively. Activity docs may carry oldValue/newValue
// directly, or a `changes` object/array describing diffs.
function extractOldNew(doc: BasicDoc): { oldValue: string; newValue: string } {
  let oldValue = coerceValue(doc.oldValue ?? doc.previousValue ?? doc.before)
  let newValue = coerceValue(doc.newValue ?? doc.nextValue ?? doc.after)

  const changes = doc.changes
  if ((!oldValue || !newValue) && changes && typeof changes === 'object') {
    // changes may be { field: { old, new } } or [{ field, old, new }]
    const parts: { old: string[]; next: string[] } = { old: [], next: [] }
    const records: Array<Record<string, unknown>> = Array.isArray(changes)
      ? (changes as Array<Record<string, unknown>>)
      : Object.entries(changes as Record<string, unknown>).map(([field, val]) => {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return { field, ...(val as Record<string, unknown>) }
          }
          return { field, new: val }
        })
    for (const record of records) {
      const field = stringValue(record.field)
      const oldV = coerceValue(record.old ?? record.oldValue ?? record.from)
      const newV = coerceValue(record.new ?? record.newValue ?? record.to ?? record.value)
      if (oldV) parts.old.push(field ? `${field}: ${oldV}` : oldV)
      if (newV) parts.next.push(field ? `${field}: ${newV}` : newV)
    }
    if (!oldValue) oldValue = parts.old.join('; ')
    if (!newValue) newValue = parts.next.join('; ')
  }

  return { oldValue, newValue }
}

async function readOrganizations(user: ApiUser): Promise<Map<string, string>> {
  const restricted = restrictedAdminOrgIds(user)
  const map = new Map<string, string>()

  if (restricted.length > 0) {
    const docs = await Promise.all(
      restricted.map((id) => adminDb.collection('organizations').doc(id).get().catch(() => null)),
    )
    for (const doc of docs) {
      if (!doc?.exists) continue
      map.set(doc.id, stringValue(doc.data()?.name, doc.id))
    }
    return map
  }

  const snapshot = await adminDb.collection('organizations').limit(300).get().catch(() => null)
  for (const doc of snapshot?.docs ?? []) {
    map.set(doc.id, stringValue(doc.data()?.name, doc.id))
  }
  return map
}

// Read raw activity docs, scoped to the admin's accessible orgs.
async function readActivityDocs(user: ApiUser, limit: number): Promise<BasicDoc[]> {
  const restricted = restrictedAdminOrgIds(user)

  if (restricted.length === 0) {
    const snapshot = await adminDb
      .collection('activity')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
      .catch(() => null)
    return snapshot ? snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) : []
  }

  const perOrg = Math.max(50, Math.ceil(limit / Math.max(restricted.length, 1)))
  const results = await Promise.all(
    restricted.map((orgId) =>
      adminDb
        .collection('activity')
        .where('orgId', '==', orgId)
        .orderBy('createdAt', 'desc')
        .limit(perOrg)
        .get()
        .catch(() => null),
    ),
  )
  return results.flatMap((snapshot) =>
    snapshot ? snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) : [],
  )
}

function toRow(doc: BasicDoc, orgs: Map<string, string>): AuditRow {
  const orgId = stringValue(doc.orgId)
  const type = stringValue(doc.type, 'activity')
  const createdAtMs = timestampMs(doc.createdAt)
  const { oldValue, newValue } = extractOldNew(doc)
  const description = stringValue(doc.description)
  return {
    id: doc.id,
    orgId,
    orgName: orgs.get(orgId) ?? (orgId || 'Platform'),
    type,
    actorId: stringValue(doc.actorId),
    actorName: stringValue(doc.actorName, stringValue(doc.actorId, 'Unknown actor')),
    actorRole: stringValue(doc.actorRole),
    description,
    entityType: stringValue(doc.entityType),
    entityId: stringValue(doc.entityId),
    oldValue,
    newValue,
    ip: stringValue(doc.ip ?? doc.ipAddress ?? doc.clientIp ?? doc.remoteIp),
    createdAtMs,
    createdAt: formatDateTime(createdAtMs),
    sensitive: SENSITIVE_ACTION_RE.test(type) || SENSITIVE_ACTION_RE.test(description),
  }
}

function applyFilters(rows: AuditRow[], filters: AuditFilters): AuditRow[] {
  const actor = filters.actor?.toLowerCase().trim()
  const action = filters.action?.toLowerCase().trim()
  return rows.filter((row) => {
    if (actor) {
      const hay = `${row.actorId} ${row.actorName}`.toLowerCase()
      if (!hay.includes(actor)) return false
    }
    if (action && !row.type.toLowerCase().includes(action)) return false
    if (filters.from != null && (row.createdAtMs == null || row.createdAtMs < filters.from)) return false
    if (filters.to != null && (row.createdAtMs == null || row.createdAtMs > filters.to)) return false
    return true
  })
}

// Compute suspicious-activity alerts over the filtered rows.
export function computeAlerts(rows: AuditRow[]): AuditAlert[] {
  const alerts: AuditAlert[] = []

  // Group by actor.
  const byActor = new Map<string, AuditRow[]>()
  for (const row of rows) {
    const key = row.actorId || row.actorName || 'unknown'
    const list = byActor.get(key)
    if (list) list.push(row)
    else byActor.set(key, [row])
  }

  for (const [actorKey, actorRows] of byActor) {
    const sorted = [...actorRows].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0))
    const actorName = sorted[0]?.actorName || actorKey
    const sensitiveRows = sorted.filter((row) => row.sensitive)

    // Sliding-window burst detection over timestamps.
    const timed = sorted.filter((row) => row.createdAtMs != null)
    let maxSensitiveInWindow = 0
    let maxTotalInWindow = 0
    let sensitiveSample: string[] = []
    for (let i = 0; i < timed.length; i++) {
      const start = timed[i].createdAtMs as number
      const window = timed.filter(
        (row) => (row.createdAtMs as number) >= start && (row.createdAtMs as number) < start + SENSITIVE_BURST_WINDOW_MS,
      )
      if (window.length > maxTotalInWindow) maxTotalInWindow = window.length
      const sensitiveWindow = window.filter((row) => row.sensitive)
      if (sensitiveWindow.length > maxSensitiveInWindow) {
        maxSensitiveInWindow = sensitiveWindow.length
        sensitiveSample = sensitiveWindow.slice(0, 5).map((row) => row.type)
      }
    }

    if (maxSensitiveInWindow > SENSITIVE_BURST_THRESHOLD) {
      alerts.push({
        id: `sensitive-burst-${actorKey}`,
        severity: 'high',
        actorId: sorted[0]?.actorId || actorKey,
        actorName,
        kind: 'sensitive-burst',
        count: maxSensitiveInWindow,
        windowMinutes: SENSITIVE_BURST_WINDOW_MS / 60000,
        message: `${actorName} performed ${maxSensitiveInWindow} sensitive actions within a single hour.`,
        sampleActions: sensitiveSample,
      })
    } else if (maxTotalInWindow > TOTAL_BURST_THRESHOLD) {
      alerts.push({
        id: `volume-burst-${actorKey}`,
        severity: 'medium',
        actorId: sorted[0]?.actorId || actorKey,
        actorName,
        kind: 'volume-burst',
        count: maxTotalInWindow,
        windowMinutes: SENSITIVE_BURST_WINDOW_MS / 60000,
        message: `${actorName} performed ${maxTotalInWindow} actions within a single hour — unusually high volume.`,
        sampleActions: Array.from(new Set(sorted.map((row) => row.type))).slice(0, 5),
      })
    } else if (sensitiveRows.length > 0 && maxSensitiveInWindow === 0 && timed.length === 0) {
      // No timestamps available but sensitive actions exist — still surface them.
      alerts.push({
        id: `sensitive-action-${actorKey}`,
        severity: 'medium',
        actorId: sorted[0]?.actorId || actorKey,
        actorName,
        kind: 'sensitive-action',
        count: sensitiveRows.length,
        windowMinutes: 0,
        message: `${actorName} performed ${sensitiveRows.length} sensitive action(s).`,
        sampleActions: sensitiveRows.slice(0, 5).map((row) => row.type),
      })
    }
  }

  // Sort: high severity first, then by count.
  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
    return b.count - a.count
  })
}

export function parseFilters(searchParams: URLSearchParams): AuditFilters {
  const fromRaw = searchParams.get('from')
  const toRaw = searchParams.get('to')
  const fromMs = fromRaw ? Date.parse(fromRaw) : NaN
  // For an inclusive "to" date (date-only), push to end of day.
  let toMs = toRaw ? Date.parse(toRaw) : NaN
  if (!Number.isNaN(toMs) && /^\d{4}-\d{2}-\d{2}$/.test(toRaw ?? '')) {
    toMs += 24 * 60 * 60 * 1000 - 1
  }
  return {
    actor: searchParams.get('actor')?.trim() || undefined,
    action: searchParams.get('action')?.trim() || undefined,
    from: Number.isNaN(fromMs) ? null : fromMs,
    to: Number.isNaN(toMs) ? null : toMs,
  }
}

// Core loader used by both the JSON route and the CSV export route.
export async function loadAuditLog(
  user: ApiUser,
  filters: AuditFilters,
  options: { scan?: number; limit?: number } = {},
): Promise<AuditLogResult> {
  const scan = Math.min(Math.max(options.scan ?? 1000, 100), 5000)
  const limit = Math.min(Math.max(options.limit ?? 250, 1), scan)

  const [orgs, docs] = await Promise.all([
    readOrganizations(user),
    readActivityDocs(user, scan),
  ])

  const allRows = docs
    .map((doc) => toRow(doc, orgs))
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))

  const filtered = applyFilters(allRows, filters)
  const alerts = computeAlerts(filtered)

  // Distinct actors / actions across the unfiltered scanned set (for filter dropdowns).
  const actorMap = new Map<string, string>()
  const actionSet = new Set<string>()
  for (const row of allRows) {
    const key = row.actorId || row.actorName
    if (key && !actorMap.has(key)) actorMap.set(key, row.actorName)
    if (row.type) actionSet.add(row.type)
  }

  return {
    rows: filtered.slice(0, limit),
    alerts,
    total: filtered.length,
    scanned: allRows.length,
    scope: restrictedAdminOrgIds(user).length > 0 ? 'restricted' : 'all',
    actors: Array.from(actorMap.entries()).map(([id, name]) => ({ id, name })),
    actions: Array.from(actionSet).sort(),
  }
}

// CSV helpers.
function csvCell(value: string): string {
  const safe = (value ?? '').replace(/"/g, '""')
  return `"${safe}"`
}

export function buildCsv(rows: AuditRow[]): string {
  const header = [
    'Timestamp',
    'Actor',
    'Actor ID',
    'Actor role',
    'Action',
    'Organization',
    'Entity type',
    'Entity ID',
    'Description',
    'Old value',
    'New value',
    'IP',
    'Sensitive',
  ]
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.createdAt,
        row.actorName,
        row.actorId,
        row.actorRole,
        row.type,
        row.orgName,
        row.entityType,
        row.entityId,
        row.description,
        row.oldValue,
        row.newValue,
        row.ip,
        row.sensitive ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n')
}
