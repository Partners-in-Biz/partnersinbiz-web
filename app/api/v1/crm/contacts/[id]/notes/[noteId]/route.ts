/**
 * PATCH  /api/v1/crm/contacts/:id/notes/:noteId  — edit a note body
 * DELETE /api/v1/crm/contacts/:id/notes/:noteId  — soft-delete a note
 *
 * Notes live in the `contact_notes` collection, org + contact scoped.
 *
 * Auth: member+ (author or privileged actor may edit/delete).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'

type RouteCtx = { params: Promise<{ id: string; noteId: string }> }

export const dynamic = 'force-dynamic'

const CONTACT_NOTES = 'contact_notes'
const MAX_BODY_LENGTH = 10_000

/**
 * Loads a note and enforces org + contact scoping. Returns the note ref + data
 * on success, or an error Response.
 */
async function loadScopedNote(
  ctx: CrmAuthContext,
  contactId: string,
  noteId: string,
): Promise<
  | { ok: true; ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }
  | { ok: false; res: Response }
> {
  const ref = adminDb.collection(CONTACT_NOTES).doc(noteId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, res: apiError('Note not found', 404) }
  const data = snap.data()!
  // Scope: note must belong to this org AND this contact, and not be deleted.
  if (data.orgId !== ctx.orgId || data.contactId !== contactId || data.deleted === true) {
    return { ok: false, res: apiError('Note not found', 404) }
  }
  return { ok: true, ref, data }
}

function canMutate(ctx: CrmAuthContext, note: Record<string, unknown>): boolean {
  // Admin/owner/system/agent can mutate any note; members only their own.
  if (ctx.role === 'admin' || ctx.isAgent) return true
  return note.authorUid === ctx.actor.uid
}

// ---------------------------------------------------------------------------
// PATCH — member+ (author or admin)
// ---------------------------------------------------------------------------

async function handleUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
) {
  const { id, noteId } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const nextBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!nextBody) return apiError('body is required', 400)
  if (nextBody.length > MAX_BODY_LENGTH) {
    return apiError(`body must be ${MAX_BODY_LENGTH} characters or fewer`, 400)
  }

  const scoped = await loadScopedNote(ctx, id, noteId)
  if (!scoped.ok) return scoped.res
  if (!canMutate(ctx, scoped.data)) {
    return apiError('You can only edit your own notes', 403)
  }

  await scoped.ref.update({
    body: nextBody,
    updatedByRef: ctx.actor,
    updatedAt: FieldValue.serverTimestamp(),
  })

  const now = new Date().toISOString()
  const note = {
    ...scoped.data,
    id: noteId,
    body: nextBody,
    updatedByRef: ctx.actor,
    updatedAt: now,
  }

  return apiSuccess({ note })
}

export const PATCH = withCrmAuth<RouteCtx>(
  'member',
  (req, ctx, routeCtx) => handleUpdate(req, ctx, routeCtx),
)

// ---------------------------------------------------------------------------
// DELETE — member+ (author or admin)
// ---------------------------------------------------------------------------

export const DELETE = withCrmAuth<RouteCtx>(
  'member',
  async (_req, ctx, routeCtx) => {
    const { id, noteId } = await routeCtx!.params

    const scoped = await loadScopedNote(ctx, id, noteId)
    if (!scoped.ok) return scoped.res
    if (!canMutate(ctx, scoped.data)) {
      return apiError('You can only delete your own notes', 403)
    }

    // Soft delete — preserves audit trail.
    await scoped.ref.update({
      deleted: true,
      deletedByRef: ctx.actor,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({ id: noteId })
  },
)
