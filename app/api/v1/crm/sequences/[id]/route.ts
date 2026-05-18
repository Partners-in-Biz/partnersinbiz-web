/**
 * GET    /api/v1/crm/sequences/:id — get sequence (member+)
 * PUT    /api/v1/crm/sequences/:id — update sequence (admin+)
 * DELETE /api/v1/crm/sequences/:id — delete sequence (admin+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getSequence, updateSequence, deleteSequence } from '@/lib/sequences/store'
import type { SequenceInput } from '@/lib/sequences/types'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    const sequence = await getSequence(ctx.orgId, id)
    if (!sequence) return apiError('Not found', 404)
    return apiSuccess({ sequence })
  } catch (err) {
    console.error('[sequences-get-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── PUT ─────────────────────────────────────────────────────────────────────────

export const PUT = withCrmAuth<RouteCtx>('admin', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

  // NEVER_FROM_BODY: id, orgId, createdAt, updatedAt, createdByRef, updatedByRef
  const {
    id: _id,
    orgId: _orgId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdByRef: _createdByRef,
    updatedByRef: _updatedByRef,
    ...rest
  } = body

  const patch: Partial<SequenceInput> = {}
  if (rest.name !== undefined) patch.name = rest.name as string
  if (rest.description !== undefined) patch.description = rest.description as string
  if (rest.status !== undefined) patch.status = rest.status as SequenceInput['status']
  if (rest.steps !== undefined) patch.steps = rest.steps as SequenceInput['steps']
  if (rest.topicId !== undefined) patch.topicId = rest.topicId as string
  if (rest.goals !== undefined) patch.goals = rest.goals as SequenceInput['goals']
  if (rest.deleted !== undefined) patch.deleted = rest.deleted as boolean

  try {
    const sequence = await updateSequence(ctx.orgId, id, patch, ctx.actor)
    return apiSuccess({ sequence })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[sequences-update-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── DELETE ──────────────────────────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    await deleteSequence(ctx.orgId, id, ctx.actor)
    return apiSuccess({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[sequences-delete-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
