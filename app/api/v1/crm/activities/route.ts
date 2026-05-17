/**
 * GET  /api/v1/crm/activities  — list activities (filterable, paginated)
 * POST /api/v1/crm/activities  — log an activity
 *
 * Query params (GET): contactId, type, limit (default 50, max 200), page,
 *                     dateFrom (ISO), dateTo (ISO)
 *
 * type supports comma-separated values: type=note,email_sent (up to 10)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { loadCompany } from '@/lib/companies/store'
import type { ActivityType, Contact } from '@/lib/crm/types'

/**
 * Best-effort: resolve companyId from a contact's companyId field.
 * Wrapped in try/catch per Sub-1 invariant — failure must NOT block the activity write.
 */
async function deriveCompanyFromContact(
  contactId: string,
  orgId: string,
): Promise<{ companyId?: string }> {
  try {
    const snap = await adminDb.collection('contacts').doc(contactId).get()
    if (!snap.exists) return {}
    const c = snap.data() as Contact
    if (c.orgId !== orgId) return {}
    if (!c.companyId) return {}
    return { companyId: c.companyId }
  } catch (e) {
    console.error('deriveCompanyFromContact failed', e)
    return {}
  }
}

function parseDate(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

const VALID_TYPES: ActivityType[] = [
  'email_sent', 'email_received', 'call', 'note',
  'stage_change', 'sequence_enrolled', 'sequence_completed',
]

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const contactId = searchParams.get('contactId') ?? undefined
  const typeParam = (searchParams.get('type') ?? '').trim()
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10), 1)
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')

  // Parse type filter — comma-separated, validated against VALID_TYPES, max 10 (Firestore 'in' limit)
  const typeFilters: ActivityType[] = typeParam
    ? typeParam
        .split(',')
        .map((t) => t.trim() as ActivityType)
        .filter((t) => VALID_TYPES.includes(t))
        .slice(0, 10)
    : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('activities').where('orgId', '==', ctx.orgId)
  if (contactId) query = query.where('contactId', '==', contactId)
  if (typeFilters.length === 1) {
    query = query.where('type', '==', typeFilters[0])
  } else if (typeFilters.length > 1) {
    query = query.where('type', 'in', typeFilters)
  }
  const fromDate = parseDate(dateFrom)
  const toDate = parseDate(dateTo)
  if (fromDate) query = query.where('createdAt', '>=', fromDate)
  if (toDate) query = query.where('createdAt', '<=', toDate)

  const offset = (page - 1) * limit
  query = query.orderBy('createdAt', 'desc').limit(limit).offset(offset)

  const snap = await query.get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((a: any) => a.deleted !== true)
  return apiSuccess({ activities, page, limit })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json()

  if (!body.contactId || typeof body.contactId !== 'string' || !body.contactId.trim()) {
    return apiError('contactId required', 400)
  }
  if (!body.type || !VALID_TYPES.includes(body.type as ActivityType)) {
    return apiError('Invalid type', 400)
  }
  if (!body.summary || typeof body.summary !== 'string' || !body.summary.trim()) {
    return apiError('summary required', 400)
  }

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef = ctx.actor

  const contactId = body.contactId.trim()

  // Derive companyId from the linked contact (best-effort, never blocks)
  let resolvedCompanyId: string | undefined
  if (body.companyId && typeof body.companyId === 'string' && body.companyId.trim()) {
    // Explicit override — validate it belongs to this org
    const loaded = await loadCompany(body.companyId.trim(), ctx.orgId)
    if (!loaded) return apiError('Invalid companyId', 400)
    resolvedCompanyId = body.companyId.trim()
  } else {
    const derived = await deriveCompanyFromContact(contactId, ctx.orgId)
    if (derived.companyId) resolvedCompanyId = derived.companyId
  }

  const docData = {
    orgId: ctx.orgId,
    contactId,
    dealId: typeof body.dealId === 'string' ? body.dealId : '',
    type: body.type as ActivityType,
    summary: body.summary.trim(),
    metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {},
    companyId: resolvedCompanyId,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: actorRef,
    createdAt: FieldValue.serverTimestamp(),
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(docData).filter(([, v]) => v !== undefined))
  const docRef = await adminDb.collection('activities').add(sanitized)
  return apiSuccess({ id: docRef.id, ...sanitized }, 201)
})
