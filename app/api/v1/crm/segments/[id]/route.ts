/**
 * GET    /api/v1/crm/segments/:id  — get one segment (viewer+)
 * PUT    /api/v1/crm/segments/:id  — update name, description, filters (admin+)
 * PATCH  /api/v1/crm/segments/:id  — alias for PUT (admin+)
 * DELETE /api/v1/crm/segments/:id  — soft delete (sets deleted: true) (admin+)
 *
 * Auth: GET → viewer+, PUT/PATCH/DELETE → admin+
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sanitizeSegmentFilters, sanitizeRuleGroup } from '@/lib/crm/segments'

const ARRAY_CONTAINS_ANY_LIMIT = 10

type RouteCtx = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Tenant-scoped loader — returns 404 for missing OR cross-org documents
// ---------------------------------------------------------------------------

async function loadSegment(id: string, ctxOrgId: string) {
  const ref = adminDb.collection('segments').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false as const, status: 404, error: 'Segment not found' }
  const data = snap.data()!
  if (data.orgId !== ctxOrgId) return { ok: false as const, status: 404, error: 'Segment not found' }
  if (data.deleted === true) return { ok: false as const, status: 404, error: 'Segment not found' }
  return { ok: true as const, ref, data }
}

// ---------------------------------------------------------------------------
// GET — viewer+
// ---------------------------------------------------------------------------

export const GET = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadSegment(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)
  return apiSuccess({ segment: { id, ...r.data } })
})

// ---------------------------------------------------------------------------
// PUT / PATCH — admin+
// ---------------------------------------------------------------------------

async function handleSegmentUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
): Promise<Response> {
  const { id } = await routeCtx!.params
  const r = await loadSegment(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)

  const body = (await req.json()) as Record<string, unknown>

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef = ctx.actor

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return apiError('Name cannot be empty', 400)
    patch.name = name
  }
  if (typeof body.description === 'string') {
    patch.description = body.description.trim()
  }
  if (body.filters !== undefined) {
    const filters = sanitizeSegmentFilters(body.filters)
    if ((filters.tags?.length ?? 0) > ARRAY_CONTAINS_ANY_LIMIT) {
      return apiError(
        `tags filter supports up to ${ARRAY_CONTAINS_ANY_LIMIT} values (array-contains-any limit)`,
        400,
      )
    }
    patch.filters = filters
  }
  // US-055: allow updating / clearing the generic rule tree.
  if (body.ruleGroup !== undefined) {
    const ruleGroup = sanitizeRuleGroup(body.ruleGroup)
    // null/empty clears the field so the segment falls back to `filters`.
    patch.ruleGroup = ruleGroup ?? FieldValue.delete()
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  await r.ref.update(sanitized)

  return apiSuccess({ segment: { id, ...r.data, ...sanitized } })
}

export const PUT = withCrmAuth<RouteCtx>('admin', handleSegmentUpdate)
export const PATCH = withCrmAuth<RouteCtx>('admin', handleSegmentUpdate)

// ---------------------------------------------------------------------------
// DELETE — admin+
// ---------------------------------------------------------------------------

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadSegment(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)

  // PR 3 pattern 1: use ctx.actor directly
  const actorRef = ctx.actor

  const deletePatch: Record<string, unknown> = {
    deleted: true,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(
    Object.entries(deletePatch).filter(([, v]) => v !== undefined),
  )
  await r.ref.update(sanitized)

  return apiSuccess({ id })
})
