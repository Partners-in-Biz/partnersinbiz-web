import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { Query } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const EVENT_SCAN_LIMIT = 1500
const RECENT_SAMPLE_LIMIT = 40
const DEADLETTER_LIMIT = 100

// In-memory shapes used while aggregating. Values mirror the product_events
// doc written by app/api/v1/analytics/ingest/route.ts.
interface EventRow {
  id: string
  orgId: string
  propertyId: string
  event: string
  sessionId: string
  pageUrl: string | null
  path: string | null
  eventMs: number | null // client/event timestamp in ms
  serverMs: number | null // server receipt time in ms
  latencyMs: number | null // serverMs - eventMs when both present AND differ
}

interface PropertySummary {
  id: string
  name: string
  domain: string
  orgId: string
  status: string
}

/** Convert a Firestore Timestamp | Date | number | iso-string to ms. */
function toMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof v.toMillis === 'function') return v.toMillis()
    if (typeof v.toDate === 'function') return v.toDate().getTime()
    if (typeof v.seconds === 'number') return v.seconds * 1000
    if (typeof v._seconds === 'number') return v._seconds * 1000
  }
  return null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1))
  return sortedAsc[idx]
}

/**
 * Read product_events honouring admin org scope + optional org/property
 * filters. We pull a recent window ordered by serverTime (the ingest path
 * always stamps serverTime), then aggregate in memory.
 */
async function readEvents(
  user: ApiUser,
  orgFilter: string | null,
  propertyFilter: string | null,
): Promise<EventRow[]> {
  const restricted = restrictedAdminOrgIds(user)
  const scopedOrgIds = new Set(restricted)

  // Resolve the effective orgId list to query against.
  let queryOrgIds: string[] = []
  if (orgFilter) {
    if (scopedOrgIds.size === 0 || scopedOrgIds.has(orgFilter)) queryOrgIds = [orgFilter]
    else return [] // requested org is outside the restricted admin's scope
  } else if (scopedOrgIds.size > 0) {
    queryOrgIds = Array.from(scopedOrgIds)
  }

  function buildBase(): Query {
    let q: Query = adminDb.collection('product_events')
    if (propertyFilter) q = q.where('propertyId', '==', propertyFilter)
    return q
  }

  const rows: EventRow[] = []
  const seen = new Set<string>()

  function pushSnap(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
    for (const doc of docs) {
      if (seen.has(doc.id)) continue
      seen.add(doc.id)
      const d = doc.data()
      const eventMs = toMs(d.timestamp)
      const serverMs = toMs(d.serverTime)
      // Honest latency: only when both exist AND differ (a client-supplied
      // event timestamp distinct from the server receipt time). When the
      // ingest path fell back to serverTime for `timestamp`, eventMs === serverMs
      // and there is no real client clock to measure against.
      const latencyMs =
        eventMs != null && serverMs != null && serverMs !== eventMs ? serverMs - eventMs : null
      const props = (d.properties as Record<string, unknown> | undefined) ?? {}
      rows.push({
        id: doc.id,
        orgId: str(d.orgId),
        propertyId: str(d.propertyId, 'unknown'),
        event: str(d.event, 'event'),
        sessionId: str(d.sessionId, 'unknown'),
        pageUrl: typeof d.pageUrl === 'string' ? d.pageUrl : null,
        path: typeof props.path === 'string' ? props.path : null,
        eventMs,
        serverMs,
        latencyMs,
      })
    }
  }

  if (queryOrgIds.length === 0) {
    // Unrestricted super-admin, no org filter: scan the recent window directly.
    const snap = await buildBase().orderBy('serverTime', 'desc').limit(EVENT_SCAN_LIMIT).get()
    pushSnap(snap.docs)
  } else {
    // Query per-org (Firestore `in` caps at 10 and we want a generous per-org
    // window). Spread the scan budget across the scoped orgs.
    const perOrg = Math.max(200, Math.floor(EVENT_SCAN_LIMIT / queryOrgIds.length))
    const snaps = await Promise.all(
      queryOrgIds.map((oid) =>
        buildBase().where('orgId', '==', oid).orderBy('serverTime', 'desc').limit(perOrg).get(),
      ),
    )
    for (const snap of snaps) pushSnap(snap.docs)
  }

  return rows
}

async function readProperties(user: ApiUser): Promise<PropertySummary[]> {
  const restricted = restrictedAdminOrgIds(user)
  let q: Query = adminDb.collection('properties')
  if (restricted.length > 0 && restricted.length <= 10) {
    q = q.where('orgId', 'in', restricted)
  }
  const snap = await q.limit(300).get()
  const restrictedSet = new Set(restricted)
  return snap.docs
    .map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        name: str(d.name, doc.id),
        domain: str(d.domain, 'unknown'),
        orgId: str(d.orgId),
        status: str(d.status, 'unknown'),
      }
    })
    .filter((p) => restrictedSet.size === 0 || restrictedSet.has(p.orgId))
}

async function readDeadLetter(
  user: ApiUser,
  orgFilter: string | null,
  propertyFilter: string | null,
): Promise<Array<Record<string, unknown>>> {
  const restricted = restrictedAdminOrgIds(user)
  const restrictedSet = new Set(restricted)
  let q: Query = adminDb.collection('product_events_deadletter')
  if (propertyFilter) q = q.where('propertyId', '==', propertyFilter)
  if (orgFilter && (restrictedSet.size === 0 || restrictedSet.has(orgFilter))) {
    q = q.where('orgId', '==', orgFilter)
  }

  let snap
  try {
    snap = await q.orderBy('failedAt', 'desc').limit(DEADLETTER_LIMIT).get()
  } catch {
    // failedAt may be absent on legacy/empty collection — fall back to unordered.
    snap = await q.limit(DEADLETTER_LIMIT).get()
  }

  return snap.docs
    .map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        orgId: str(d.orgId),
        propertyId: str(d.propertyId, 'unknown'),
        event: str(d.event, 'event'),
        sessionId: str(d.sessionId),
        reason: str(d.reason ?? d.error, 'unknown'),
        pageUrl: typeof d.pageUrl === 'string' ? d.pageUrl : null,
        failedAtMs: toMs(d.failedAt),
      }
    })
    .filter((d) => {
      if (restrictedSet.size > 0 && !restrictedSet.has(String(d.orgId))) return false
      if (orgFilter && d.orgId !== orgFilter) return false
      return true
    })
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgFilter = url.searchParams.get('orgId')?.trim() || null
  const propertyFilter = url.searchParams.get('propertyId')?.trim() || null

  const [events, properties, deadLetter] = await Promise.all([
    readEvents(user, orgFilter, propertyFilter),
    readProperties(user),
    readDeadLetter(user, orgFilter, propertyFilter),
  ])

  const now = Date.now()
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const WEEK = 604_800_000

  // Use serverMs (receipt time) for windowing — it is always present.
  const at = (e: EventRow) => e.serverMs ?? e.eventMs ?? 0
  const lastHour = events.filter((e) => at(e) >= now - HOUR)
  const lastDay = events.filter((e) => at(e) >= now - DAY)
  const lastWeek = events.filter((e) => at(e) >= now - WEEK)

  // 24h time series, bucketed hourly (24 buckets, oldest -> newest).
  const buckets: number[] = new Array(24).fill(0)
  for (const e of lastDay) {
    const ageMs = now - at(e)
    const bucketFromNow = Math.floor(ageMs / HOUR) // 0 = current hour
    if (bucketFromNow >= 0 && bucketFromNow < 24) buckets[23 - bucketFromNow]++
  }
  const series = buckets.map((count, i) => ({
    // label = hours ago for the start of the bucket
    hoursAgo: 23 - i,
    count,
  }))

  // Latency p50/p95 over the 24h window — only real client-vs-server pairs.
  const latencies = lastDay
    .map((e) => e.latencyMs)
    .filter((v): v is number => v != null && v >= 0)
    .sort((a, b) => a - b)
  const latencyAvailable = latencies.length > 0
  const p50 = latencyAvailable ? percentile(latencies, 50) : null
  const p95 = latencyAvailable ? percentile(latencies, 95) : null

  // Top properties by 7d volume.
  const propVolume = new Map<string, number>()
  for (const e of lastWeek) propVolume.set(e.propertyId, (propVolume.get(e.propertyId) ?? 0) + 1)
  const propMap = new Map(properties.map((p) => [p.id, p]))
  const topProperties = Array.from(propVolume.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([propertyId, volume]) => {
      const p = propMap.get(propertyId)
      const lastSeen = lastWeek.find((e) => e.propertyId === propertyId)
      return {
        propertyId,
        name: p?.name ?? propertyId,
        domain: p?.domain ?? 'unknown',
        orgId: p?.orgId ?? lastSeen?.orgId ?? 'unknown',
        volume,
        lastSeenMs: lastSeen ? at(lastSeen) : null,
      }
    })

  const recentEvents = [...events]
    .sort((a, b) => at(b) - at(a))
    .slice(0, RECENT_SAMPLE_LIMIT)
    .map((e) => ({
      id: e.id,
      event: e.event,
      propertyId: e.propertyId,
      orgId: e.orgId,
      sessionId: e.sessionId,
      path: e.path ?? e.pageUrl ?? null,
      timestampMs: at(e),
      latencyMs: e.latencyMs,
    }))

  return apiSuccess({
    filters: { orgId: orgFilter, propertyId: propertyFilter },
    counts: {
      lastHour: lastHour.length,
      lastDay: lastDay.length,
      lastWeek: lastWeek.length,
      propertiesSeen: new Set(lastWeek.map((e) => e.propertyId)).size,
      scanned: events.length,
    },
    series,
    latency: {
      available: latencyAvailable,
      p50Ms: p50,
      p95Ms: p95,
      sampleSize: latencies.length,
      note: latencyAvailable
        ? 'Latency = serverTime − client event timestamp (ms), over events that carry a distinct client clock.'
        : 'No events carry a client-supplied event timestamp distinct from server receipt time, so end-to-end latency cannot be measured. The ingest path stores `timestamp` (client, optional) and `serverTime` (receipt); when a client omits its clock both collapse to the same value.',
    },
    deadLetter: {
      count: deadLetter.length,
      items: deadLetter,
    },
    topProperties,
    recentEvents,
    properties: properties.map((p) => ({ id: p.id, name: p.name, domain: p.domain, orgId: p.orgId })),
  })
})
