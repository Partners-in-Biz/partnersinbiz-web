import { withAuth } from '@/lib/api/auth'
import { adminDb } from '@/lib/firebase/admin'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { Query } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const EXPORT_LIMIT = 2000

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

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function readEvents(
  user: ApiUser,
  orgFilter: string | null,
  propertyFilter: string | null,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const restricted = restrictedAdminOrgIds(user)
  const scopedOrgIds = new Set(restricted)

  let queryOrgIds: string[] = []
  if (orgFilter) {
    if (scopedOrgIds.size === 0 || scopedOrgIds.has(orgFilter)) queryOrgIds = [orgFilter]
    else return []
  } else if (scopedOrgIds.size > 0) {
    queryOrgIds = Array.from(scopedOrgIds)
  }

  function buildBase(): Query {
    let q: Query = adminDb.collection('product_events')
    if (propertyFilter) q = q.where('propertyId', '==', propertyFilter)
    return q
  }

  if (queryOrgIds.length === 0) {
    const snap = await buildBase().orderBy('serverTime', 'desc').limit(EXPORT_LIMIT).get()
    return snap.docs
  }

  const perOrg = Math.max(200, Math.floor(EXPORT_LIMIT / queryOrgIds.length))
  const snaps = await Promise.all(
    queryOrgIds.map((oid) =>
      buildBase().where('orgId', '==', oid).orderBy('serverTime', 'desc').limit(perOrg).get(),
    ),
  )
  const seen = new Set<string>()
  const out: FirebaseFirestore.QueryDocumentSnapshot[] = []
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue
      seen.add(doc.id)
      out.push(doc)
    }
  }
  return out
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgFilter = url.searchParams.get('orgId')?.trim() || null
  const propertyFilter = url.searchParams.get('propertyId')?.trim() || null

  const docs = await readEvents(user, orgFilter, propertyFilter)

  const header = [
    'id',
    'event',
    'orgId',
    'propertyId',
    'sessionId',
    'distinctId',
    'pageUrl',
    'path',
    'eventTimestampISO',
    'serverTimeISO',
    'latencyMs',
  ]

  const lines = [header.join(',')]
  for (const doc of docs) {
    const d = doc.data()
    const eventMs = toMs(d.timestamp)
    const serverMs = toMs(d.serverTime)
    const latencyMs = eventMs != null && serverMs != null && serverMs !== eventMs ? serverMs - eventMs : ''
    const props = (d.properties as Record<string, unknown> | undefined) ?? {}
    const row = [
      doc.id,
      d.event ?? '',
      d.orgId ?? '',
      d.propertyId ?? '',
      d.sessionId ?? '',
      d.distinctId ?? '',
      d.pageUrl ?? '',
      typeof props.path === 'string' ? props.path : '',
      eventMs != null ? new Date(eventMs).toISOString() : '',
      serverMs != null ? new Date(serverMs).toISOString() : '',
      latencyMs,
    ]
    lines.push(row.map(csvCell).join(','))
  }

  const csv = lines.join('\r\n')
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ingestion.csv"',
      'Cache-Control': 'no-store',
    },
  })
})
