/**
 * GET    /api/v1/crm/contacts/:id  — get one contact
 * PUT    /api/v1/crm/contacts/:id  — update contact (full replace)
 * PATCH  /api/v1/crm/contacts/:id  — update contact (alias for PUT)
 * DELETE /api/v1/crm/contacts/:id  — soft delete (sets deleted: true)
 *
 * Auth:
 *   GET    → viewer+
 *   PUT/PATCH → member+
 *   DELETE → member+ (with membersCanDeleteContacts toggle for member role)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { resolveMemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { loadCompany } from '@/lib/companies/store'
import { sanitizeContactForWrite } from '@/lib/crm/contacts'
import { getDefinitionsForResource } from '@/lib/customFields/store'
import { validateCustomFields } from '@/lib/customFields/validation'

type RouteCtx = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// GET — viewer+
// ---------------------------------------------------------------------------

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params
    const docRef = adminDb.collection('contacts').doc(id)
    const snap = await docRef.get()
    if (!snap.exists) return apiError('Contact not found', 404)
    const data = snap.data()!
    if (data.orgId !== ctx.orgId) return apiError('Contact not found', 404)
    return apiSuccess({ contact: { id: snap.id, ...data } })
  },
)

// ---------------------------------------------------------------------------
// PUT/PATCH — member+
// ---------------------------------------------------------------------------

async function handleUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
) {
  const { id } = await routeCtx!.params
  const body = await req.json()
  const docRef = adminDb.collection('contacts').doc(id)
  const snap = await docRef.get()
  if (!snap.exists) return apiError('Contact not found', 404)
  const existing = snap.data()!
  if (existing.orgId !== ctx.orgId) return apiError('Contact not found', 404)

  const actorRef = ctx.actor

  // Strip NEVER_FROM_BODY fields (orgId, createdBy*, etc.) before spread —
  // blocks cross-tenant write via body field injection. Mirrors the companies
  // fix (commit 1907d8f).
  const patch: Record<string, unknown> = {
    ...sanitizeContactForWrite(body),
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Resolve assignedToRef when assignedTo changes (uses tolerant resolveMemberRef — never throws)
  if (typeof body.assignedTo === 'string' && body.assignedTo !== '') {
    patch.assignedToRef = await resolveMemberRef(ctx.orgId, body.assignedTo)
  }

  // Resolve companyId wiring (hybrid model — existing company string field untouched)
  if ('companyId' in body) {
    if (body.companyId === '' || body.companyId === null) {
      // Explicit clear: remove both fields from Firestore document
      patch.companyId = FieldValue.delete()
      patch.companyName = FieldValue.delete()
    } else if (typeof body.companyId === 'string') {
      const loaded = await loadCompany(body.companyId, ctx.orgId)
      if (!loaded) return apiError('Invalid companyId (not found or cross-tenant)', 400)
      patch.companyId = body.companyId
      patch.companyName = loaded.data.name
    }
    // Remove raw companyId from patch so it doesn't overwrite resolved value
    // (patch.companyId is already set above; remove the body spread duplicate)
  }

  // Custom field validation (best-effort — Firestore outage must not block core write)
  if (body.customFields !== undefined && body.customFields !== null) {
    try {
      const defs = await getDefinitionsForResource(ctx.orgId, 'contact')
      const errs = validateCustomFields(defs, body.customFields as Record<string, unknown>)
      if (errs.length > 0) {
        return apiError(`Custom field validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`, 400)
      }
    } catch (err) {
      console.error('custom-field-validation-skipped', err)
    }
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  )

  await docRef.update(sanitized)

  try {
    await dispatchWebhook(ctx.orgId, 'contact.updated', { id, ...body, updatedByRef: actorRef })
  } catch (err) {
    console.error('[webhook-dispatch-error] contact.updated', err)
  }

  logActivity({
    orgId: ctx.orgId,
    type: 'crm_contact_updated',
    actorId: ctx.actor.uid,
    actorName: ctx.actor.displayName,
    actorRole: ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client',
    description: `Updated contact ${existing.name ?? id}`,
    entityId: id,
    entityType: 'contact',
    entityTitle: existing.name ?? id,
  }).catch(() => {})

  return apiSuccess({ contact: { id, ...existing, ...sanitized } })
}

export const PUT = withCrmAuth<RouteCtx>(
  'member',
  (req, ctx, routeCtx) => handleUpdate(req, ctx, routeCtx),
)

export const PATCH = withCrmAuth<RouteCtx>(
  'member',
  (req, ctx, routeCtx) => handleUpdate(req, ctx, routeCtx),
)

// ---------------------------------------------------------------------------
// DELETE — member+ with toggle gate
// ---------------------------------------------------------------------------

export const DELETE = withCrmAuth<RouteCtx>(
  'member',
  async (_req, ctx, routeCtx) => {
    // Toggle gate: members are blocked when membersCanDeleteContacts is false
    // Admin/owner/system bypass this check
    if (ctx.role === 'member' && !ctx.permissions.membersCanDeleteContacts) {
      return apiError('Members are not allowed to delete contacts in this workspace', 403)
    }

    const { id } = await routeCtx!.params
    const docRef = adminDb.collection('contacts').doc(id)
    const snap = await docRef.get()
    if (!snap.exists) return apiError('Contact not found', 404)
    const existing = snap.data()!
    if (existing.orgId !== ctx.orgId) return apiError('Contact not found', 404)

    const actorRef = ctx.actor

    // Soft delete
    const softDeletePatch: Record<string, unknown> = {
      deleted: true,
      updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
      updatedByRef: actorRef,
      updatedAt: FieldValue.serverTimestamp(),
    }
    const sanitized = Object.fromEntries(
      Object.entries(softDeletePatch).filter(([, v]) => v !== undefined),
    )
    await docRef.update(sanitized)

    logActivity({
      orgId: ctx.orgId,
      type: 'crm_contact_deleted',
      actorId: ctx.actor.uid,
      actorName: ctx.actor.displayName,
      actorRole: ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client',
      description: `Deleted contact ${existing.name ?? id}`,
      entityId: id,
      entityType: 'contact',
      entityTitle: existing.name ?? id,
    }).catch(() => {})

    return apiSuccess({ id })
  },
)
