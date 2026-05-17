/**
 * GET    /api/v1/crm/companies/:id — get one company
 * PUT    /api/v1/crm/companies/:id — full replace update
 * PATCH  /api/v1/crm/companies/:id — partial update
 * DELETE /api/v1/crm/companies/:id — soft delete (cascades companyId clear to related docs)
 *
 * Auth:
 *   GET          → viewer+
 *   PUT / PATCH  → member+
 *   DELETE       → admin+
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  loadCompany,
  sanitizeCompanyForWrite,
  validateParentChain,
  validateAccountManager,
  clearCompanyIdOnCollection,
  loadMemberRef,
} from '@/lib/companies/store'
import { getDefinitionsForResource } from '@/lib/customFields/store'
import { validateCustomFields } from '@/lib/customFields/validation'

type RouteCtx = { params: Promise<{ id: string }> }

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params
    const loaded = await loadCompany(id, ctx.orgId)
    if (!loaded) return apiError('Company not found', 404)
    return apiSuccess({ company: loaded.data })
  },
)

// ── PUT / PATCH (shared logic) ──────────────────────────────────────────────────

async function handleUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
) {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

  const loaded = await loadCompany(id, ctx.orgId)
  if (!loaded) return apiError('Company not found', 404)

  // Validate parent chain if changing
  if ('parentCompanyId' in body && body.parentCompanyId) {
    const validChain = await validateParentChain(ctx.orgId, id, body.parentCompanyId as string)
    if (!validChain) return apiError('Invalid parentCompanyId: creates a cycle or crosses tenants', 400)
  }

  // Validate account manager if changing + resolve ref snapshot
  let accountManagerRefPatch: undefined | { accountManagerRef: unknown } = undefined
  if ('accountManagerUid' in body) {
    if (body.accountManagerUid === '' || body.accountManagerUid === null) {
      // Explicit unset — clear both fields below via sanitized + FieldValue.delete on ref
      accountManagerRefPatch = { accountManagerRef: (await import('firebase-admin/firestore')).FieldValue.delete() }
    } else if (body.accountManagerUid) {
      const ref = await loadMemberRef(ctx.orgId, body.accountManagerUid as string)
      if (!ref) return apiError('accountManagerUid does not belong to this workspace', 400)
      accountManagerRefPatch = { accountManagerRef: ref }
    }
  }

  const sanitized = sanitizeCompanyForWrite(body)

  // Custom field validation (best-effort — Firestore outage must not block core write)
  if (body.customFields !== undefined && body.customFields !== null) {
    try {
      const defs = await getDefinitionsForResource(ctx.orgId, 'company')
      const errs = validateCustomFields(defs, body.customFields as Record<string, unknown>)
      if (errs.length > 0) {
        return apiError(`Custom field validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`, 400)
      }
    } catch (err) {
      console.error('custom-field-validation-skipped', err)
    }
  }

  const patch: Record<string, unknown> = {
    ...sanitized,
    ...(accountManagerRefPatch ?? {}),
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    updatedAt: Timestamp.now(),
  }

  // Strip undefined values
  const toWrite = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  )

  await loaded.ref.update(toWrite)

  return apiSuccess({ company: { ...loaded.data, ...toWrite, id } })
}

export const PUT = withCrmAuth<RouteCtx>(
  'member',
  (req, ctx, routeCtx) => handleUpdate(req, ctx, routeCtx),
)

export const PATCH = withCrmAuth<RouteCtx>(
  'member',
  (req, ctx, routeCtx) => handleUpdate(req, ctx, routeCtx),
)

// ── DELETE (admin+ with cascade) ────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>(
  'admin',
  async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    const loaded = await loadCompany(id, ctx.orgId)
    if (!loaded) return apiError('Company not found', 404)

    // Soft delete
    const softDeletePatch: Record<string, unknown> = {
      deleted: true,
      updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
      updatedByRef: ctx.actor,
      updatedAt: FieldValue.serverTimestamp(),
    }
    const toWrite = Object.fromEntries(
      Object.entries(softDeletePatch).filter(([, v]) => v !== undefined),
    )
    await loaded.ref.update(toWrite)

    // Cascade: clear companyId + companyName from related collections
    // Best-effort — failures are logged but do NOT fail the response
    try {
      await Promise.all([
        clearCompanyIdOnCollection('contacts', ctx.orgId, id),
        clearCompanyIdOnCollection('deals', ctx.orgId, id),
        clearCompanyIdOnCollection('quotes', ctx.orgId, id),
        clearCompanyIdOnCollection('activities', ctx.orgId, id),
      ])
    } catch (e) {
      console.error('company-delete-cascade-failed', id, e)
    }

    return apiSuccess({ id })
  },
)
