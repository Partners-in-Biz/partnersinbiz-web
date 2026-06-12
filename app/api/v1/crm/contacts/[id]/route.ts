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
import { normalizeAgreementRoles, sanitizeContactForWrite } from '@/lib/crm/contacts'
import { getDefinitionsForResource } from '@/lib/customFields/store'
import { validateCustomFields } from '@/lib/customFields/validation'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  normalizeAllowedUserIds,
  normalizeAllowedUserPatch,
} from '@/lib/crm/assignment-access'

type RouteCtx = { params: Promise<{ id: string }> }

type ContactCompanyLink = {
  companyId: string
  companyName: string
  roleTitle?: string
  relationshipType?: string
  primary?: boolean
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

async function normalizeCompanyLinks(rawLinks: unknown, orgId: string, existingPrimary?: { companyId?: unknown }): Promise<ContactCompanyLink[] | null> {
  const input = Array.isArray(rawLinks) ? rawLinks : []
  const links: ContactCompanyLink[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    const companyId = cleanOptionalString(row.companyId)
    if (!companyId) return null
    const loaded = await loadCompany(companyId, orgId)
    if (!loaded) return null
    const next: ContactCompanyLink = {
      companyId,
      companyName: loaded.data.name,
      ...(cleanOptionalString(row.roleTitle) ? { roleTitle: cleanOptionalString(row.roleTitle) } : {}),
      ...(cleanOptionalString(row.relationshipType) ? { relationshipType: cleanOptionalString(row.relationshipType) } : {}),
      ...(row.primary === true ? { primary: true } : {}),
    }
    const existingIndex = links.findIndex((link) => link.companyId === companyId)
    if (existingIndex >= 0) links[existingIndex] = { ...links[existingIndex], ...next }
    else links.push(next)
  }

  const primaryId = cleanOptionalString(existingPrimary?.companyId)
  if (primaryId && !links.some((link) => link.companyId === primaryId)) {
    const loaded = await loadCompany(primaryId, orgId)
    if (!loaded) return null
    links.unshift({ companyId: primaryId, companyName: loaded.data.name, primary: true })
  }

  return links.map((link, index) => index === 0 && !links.some((candidate) => candidate.primary)
    ? { ...link, primary: true }
    : link)
}


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
    if (data.orgId !== ctx.orgId || data.deleted === true) return apiError('Contact not found', 404)
    if (!isCrmPrivilegedActor(ctx)) {
      const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
      if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
        return apiError('Contact not found', 404)
      }
    }
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
  if (existing.orgId !== ctx.orgId || existing.deleted === true) return apiError('Contact not found', 404)
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(existing))
    if (!crmActorCanReadRecord(ctx, { id, ...existing }, { companies })) {
      return apiError('Contact not found', 404)
    }
  }

  const actorRef = ctx.actor
  const agreementRoles = normalizeAgreementRoles(body.agreementRoles)
  if (agreementRoles === null) return apiError('Invalid agreementRoles', 400)

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
    if (!isCrmPrivilegedActor(ctx) && body.assignedTo !== ctx.actor.uid) {
      return apiError('You can only assign contacts to yourself with your current CRM access', 403)
    }
    patch.assignedToRef = await resolveMemberRef(ctx.orgId, body.assignedTo)
    const allowedUserIds = normalizeAllowedUserPatch(body.allowedUserIds) ?? normalizeAllowedUserIds(existing.allowedUserIds)
    if (!allowedUserIds.includes(body.assignedTo)) allowedUserIds.push(body.assignedTo)
    patch.allowedUserIds = allowedUserIds
  } else if (body.assignedTo === '') {
    patch.assignedToRef = FieldValue.delete()
  }

  const allowedUserPatch = normalizeAllowedUserPatch(body.allowedUserIds)
  if (allowedUserPatch !== null) {
    patch.allowedUserIds = allowedUserPatch
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



  if ('companyLinks' in body || 'companyId' in body) {
    const normalizedLinks = await normalizeCompanyLinks(body.companyLinks, ctx.orgId, {
      companyId: body.companyId ?? existing.companyId,
    })
    if (normalizedLinks === null) return apiError('Invalid companyLinks', 400)
    patch.companyLinks = normalizedLinks
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

  // ── Automation trigger (A6) — best-effort ──────────────────────────────────
  const typeChanged =
    typeof body.type === 'string' && body.type !== existing.type
  if (typeChanged) {
    try {
      const { fireTrigger } = await import('@/lib/automations/trigger')
      const contactEmail =
        typeof existing.email === 'string' ? existing.email : undefined
      await fireTrigger('contact.lifecycle_changed', {
        orgId: ctx.orgId,
        contactId: id,
        contactEmail,
      })
    } catch { /* best-effort */ }
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
    if (existing.orgId !== ctx.orgId || existing.deleted === true) return apiError('Contact not found', 404)
    if (!isCrmPrivilegedActor(ctx)) {
      const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(existing))
      if (!crmActorCanReadRecord(ctx, { id, ...existing }, { companies })) {
        return apiError('Contact not found', 404)
      }
    }

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
