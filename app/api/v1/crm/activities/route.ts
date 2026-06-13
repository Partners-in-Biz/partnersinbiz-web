/**
 * GET  /api/v1/crm/activities  — list activities (filterable, paginated)
 * POST /api/v1/crm/activities  — log an activity
 *
 * Query params (GET): contactId, type, limit (default 50, max 200), page,
 *                     dateFrom (ISO), dateTo (ISO)
 *
 * type supports comma-separated values: type=note,email_sent (up to 10)
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { loadCompany } from '@/lib/companies/store'
import type { ActivityType, Contact } from '@/lib/crm/types'
import {
  crmActorCanReadRecord,
  crmActorCanReadCompanyRecord,
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'

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

type ActivityRow = Record<string, unknown> & {
  id: string
  deleted?: boolean
  createdAt?: unknown
}

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
  let activities: ActivityRow[] = snap.docs
    .map((d: any) => ({ id: d.id, ...d.data() }) as ActivityRow)
    .filter((a: any) => a.deleted !== true)
  if (!isCrmPrivilegedActor(ctx)) {
    const contacts = await loadContactAssignmentMap(ctx.orgId, activities.flatMap((activity) => crmRecordContactIds(activity)))
    const companyIds = new Set<string>()
    for (const activity of activities) {
      for (const companyId of crmRecordCompanyIds(activity)) companyIds.add(companyId)
      for (const linkedContactId of crmRecordContactIds(activity)) {
        for (const companyId of crmRecordCompanyIds(contacts.get(linkedContactId))) companyIds.add(companyId)
      }
    }
    const companies = await loadCompanyAssignmentMap(ctx.orgId, companyIds)
    activities = filterCrmRowsForActor(ctx, activities, { contacts, companies })
  }
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
  let contactSnap: { exists: boolean; id: string; data: () => unknown }
  try {
    contactSnap = await adminDb.collection('contacts').doc(contactId).get()
  } catch (err) {
    console.error('activity-contact-validation-failed', err)
    return apiError('Contact lookup failed', 500)
  }
  if (!contactSnap.exists) return apiError('Contact not found', 404)
  const contact = { ...(contactSnap.data() as Contact), id: contactSnap.id }
  if (contact.orgId !== ctx.orgId || contact.deleted === true) return apiError('Contact not found', 404)
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(contact))
    if (!crmActorCanReadRecord(ctx, contact, { companies })) return apiError('Contact not found', 404)
  }

  // Derive companyId from the linked contact (best-effort, never blocks)
  let resolvedCompanyId: string | undefined
  if (body.companyId && typeof body.companyId === 'string' && body.companyId.trim()) {
    // Explicit override — validate it belongs to this org
    const loaded = await loadCompany(body.companyId.trim(), ctx.orgId)
    if (!loaded) return apiError('Invalid companyId', 400)
    if (!isCrmPrivilegedActor(ctx) && !(await crmActorCanReadCompanyRecord(ctx, body.companyId.trim(), loaded.data))) {
      return apiError('Invalid companyId', 400)
    }
    resolvedCompanyId = body.companyId.trim()
  } else {
    const derived = await deriveCompanyFromContact(contactId, ctx.orgId)
    if (derived.companyId) resolvedCompanyId = derived.companyId
  }

  // occurredAt: caller-supplied timestamp for when the activity actually happened.
  // Falls back to server timestamp so existing callers are unaffected.
  let occurredAt: Timestamp | ReturnType<typeof FieldValue.serverTimestamp>
  if (body.occurredAt && typeof body.occurredAt === 'string') {
    const d = new Date(body.occurredAt)
    occurredAt = isNaN(d.getTime()) ? FieldValue.serverTimestamp() : Timestamp.fromDate(d)
  } else {
    occurredAt = FieldValue.serverTimestamp()
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
    occurredAt,
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(docData).filter(([, v]) => v !== undefined))
  const docRef = await adminDb.collection('activities').add(sanitized)
  return apiSuccess({ id: docRef.id, ...sanitized }, 201)
})
