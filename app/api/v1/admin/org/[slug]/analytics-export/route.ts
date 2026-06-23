/**
 * POST /api/v1/admin/org/[slug]/analytics-export (US-296)
 * GET  /api/v1/admin/org/[slug]/analytics-export — list recent export jobs
 *
 * POST gathers the matching rows from Firestore for the requested type +
 * date-range, builds a CSV string, records a completed job under
 * `organizations/{id}/exports`, audits it, and returns the CSV inline so the
 * client can trigger a Blob download. No background workers — synchronous.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { resolveOrgBySlug } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }
type ExportType = 'contacts' | 'emails' | 'social' | 'activity'

const EXPORT_TYPES: ExportType[] = ['contacts', 'emails', 'social', 'activity']

const COLLECTION_FOR: Record<ExportType, string> = {
  contacts: 'contacts',
  emails: 'emails',
  social: 'social_posts',
  activity: 'activities',
}

// Field used for date-range filtering / created-at column per type.
const DATE_FIELD_FOR: Record<ExportType, string> = {
  contacts: 'createdAt',
  emails: 'sentAt',
  social: 'createdAt',
  activity: 'createdAt',
}

// Columns extracted per export type (header order preserved).
const COLUMNS_FOR: Record<ExportType, string[]> = {
  contacts: ['id', 'firstName', 'lastName', 'email', 'phone', 'company', 'status', 'createdAt'],
  emails: ['id', 'to', 'subject', 'status', 'sentAt'],
  social: ['id', 'platform', 'status', 'content', 'createdAt'],
  activity: ['id', 'type', 'description', 'actorUid', 'createdAt'],
}

function tsToIso(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const seconds = (value as { _seconds?: number; seconds?: number })._seconds
      ?? (value as { seconds?: number }).seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  return ''
}

function csvCell(value: unknown): string {
  let s: string
  if (value === null || value === undefined) s = ''
  else if (typeof value === 'object') s = tsToIso(value) || JSON.stringify(value)
  else s = String(value)
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

function buildCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.join(',')
  const lines = rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))
  return [header, ...lines].join('\n')
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const body = await req.json().catch(() => ({}))
  const type = body?.type as ExportType
  if (!EXPORT_TYPES.includes(type)) {
    return apiError(`type must be one of: ${EXPORT_TYPES.join(', ')}`, 400)
  }
  const dateFrom = typeof body?.dateFrom === 'string' ? body.dateFrom : null
  const dateTo = typeof body?.dateTo === 'string' ? body.dateTo : null

  const collection = COLLECTION_FOR[type]
  const dateField = DATE_FIELD_FOR[type]
  const columns = COLUMNS_FOR[type]

  let query: FirebaseFirestore.Query = adminDb.collection(collection).where('orgId', '==', id)
  const fromMs = dateFrom ? Date.parse(dateFrom) : NaN
  const toMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999Z`) : NaN
  if (Number.isFinite(fromMs)) query = query.where(dateField, '>=', Timestamp.fromMillis(fromMs))
  if (Number.isFinite(toMs)) query = query.where(dateField, '<=', Timestamp.fromMillis(toMs))

  let rows: Array<Record<string, unknown>> = []
  try {
    const snap = await query.limit(10000).get()
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to gather export rows', 500)
  }

  const csv = buildCsv(columns, rows)
  const rowCount = rows.length
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `${slug}-${type}-${stamp}.csv`

  // Record the job.
  const jobRef = await adminDb
    .collection('organizations').doc(id)
    .collection('exports').add({
      type,
      range: { from: dateFrom, to: dateTo },
      rowCount,
      filename,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      status: 'complete',
    })

  await writeAdminAudit(user, {
    action: 'org.analytics_export',
    orgId: id,
    summary: `Exported ${rowCount} ${type} row(s) for "${org.name ?? slug}"`,
    metadata: { slug, type, dateFrom, dateTo, rowCount, jobId: jobRef.id },
  })

  return apiSuccess({ csv, rowCount, filename, jobId: jobRef.id })
})

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)

  let jobs: Array<Record<string, unknown>> = []
  try {
    const snap = await adminDb
      .collection('organizations').doc(resolved.id)
      .collection('exports').get()
    jobs = snap.docs
      .map((d) => {
        const data = d.data()
        const ts = data.createdAt as { _seconds?: number; seconds?: number } | undefined
        const seconds = ts?._seconds ?? ts?.seconds
        return {
          id: d.id,
          type: data.type ?? 'unknown',
          range: data.range ?? null,
          rowCount: typeof data.rowCount === 'number' ? data.rowCount : 0,
          filename: data.filename ?? null,
          status: data.status ?? 'complete',
          createdAt: typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null,
        }
      })
      .sort((a, b) => (b.createdAt ? Date.parse(b.createdAt as string) : 0) - (a.createdAt ? Date.parse(a.createdAt as string) : 0))
      .slice(0, 25)
  } catch {
    jobs = []
  }

  return apiSuccess({ jobs })
})
