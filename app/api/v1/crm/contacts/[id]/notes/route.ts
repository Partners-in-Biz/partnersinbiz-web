/**
 * GET  /api/v1/crm/contacts/:id/notes  — list notes for a contact (newest first)
 * POST /api/v1/crm/contacts/:id/notes  — create a note { body }
 *
 * Notes live in the `contact_notes` collection, org + contact scoped.
 *
 * Auth:
 *   GET  → viewer+
 *   POST → member+
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

type RouteCtx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

const CONTACT_NOTES = 'contact_notes'
const MAX_BODY_LENGTH = 10_000

/**
 * Loads the contact and enforces org + row-level access. Returns the contact
 * data on success, or an error Response that callers should return directly.
 */
async function loadAccessibleContact(
  ctx: CrmAuthContext,
  contactId: string,
): Promise<{ ok: true; contact: Record<string, unknown> } | { ok: false; res: Response }> {
  const snap = await adminDb.collection('contacts').doc(contactId).get()
  if (!snap.exists) return { ok: false, res: apiError('Contact not found', 404) }
  const data = snap.data()!
  if (data.orgId !== ctx.orgId || data.deleted === true) {
    return { ok: false, res: apiError('Contact not found', 404) }
  }
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
    if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
      return { ok: false, res: apiError('Contact not found', 404) }
    }
  }
  return { ok: true, contact: { id: snap.id, ...data } }
}

// ---------------------------------------------------------------------------
// GET — viewer+
// ---------------------------------------------------------------------------

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    const access = await loadAccessibleContact(ctx, id)
    if (!access.ok) return access.res

    // Org + contact scoped. Filter soft-deleted in memory so a missing composite
    // index never blocks the read.
    const snap = await adminDb
      .collection(CONTACT_NOTES)
      .where('orgId', '==', ctx.orgId)
      .where('contactId', '==', id)
      .get()

    const notes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
      .filter((n) => n.deleted !== true)
      .sort((a, b) => {
        const av = millis(a.createdAt)
        const bv = millis(b.createdAt)
        return bv - av
      })

    return apiSuccess({ notes })
  },
)

// ---------------------------------------------------------------------------
// POST — member+
// ---------------------------------------------------------------------------

async function handleCreate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
) {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const noteBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!noteBody) return apiError('body is required', 400)
  if (noteBody.length > MAX_BODY_LENGTH) {
    return apiError(`body must be ${MAX_BODY_LENGTH} characters or fewer`, 400)
  }

  const access = await loadAccessibleContact(ctx, id)
  if (!access.ok) return access.res

  const actorRef = ctx.actor
  const docData = {
    orgId: ctx.orgId,
    contactId: id,
    body: noteBody,
    authorUid: ctx.actor.uid,
    authorName: ctx.actor.displayName ?? '',
    createdByRef: actorRef,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  }

  const ref = await adminDb.collection(CONTACT_NOTES).add(docData)

  // Return the created note with a client-usable timestamp (serverTimestamp
  // sentinels are not serializable, so substitute an ISO string).
  const now = new Date().toISOString()
  const note = {
    id: ref.id,
    ...docData,
    createdAt: now,
    updatedAt: now,
  }

  return apiSuccess({ note }, 201)
}

export const POST = withCrmAuth<RouteCtx>(
  'member',
  (req, ctx, routeCtx) => handleCreate(req, ctx, routeCtx),
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function millis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const c = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof c.toMillis === 'function') return c.toMillis()
    if (typeof c.toDate === 'function') return c.toDate().getTime()
    if (typeof c.seconds === 'number') return c.seconds * 1000
    if (typeof c._seconds === 'number') return c._seconds * 1000
  }
  return 0
}
