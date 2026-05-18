/**
 * PUT    /api/v1/crm/products/:id — update product (admin+)
 * DELETE /api/v1/crm/products/:id — delete product (admin+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { updateProduct, deleteProduct } from '@/lib/products/store'
import type { ProductInput } from '@/lib/products/types'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

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

  const patch: Partial<ProductInput> = {}
  if (rest.name !== undefined) patch.name = rest.name as string
  if (rest.unitPrice !== undefined) patch.unitPrice = rest.unitPrice as number
  if (rest.currency !== undefined) patch.currency = rest.currency as ProductInput['currency']
  if (rest.description !== undefined) patch.description = rest.description as string
  if (rest.unit !== undefined) patch.unit = rest.unit as string
  if (rest.deleted !== undefined) patch.deleted = rest.deleted as boolean

  try {
    const product = await updateProduct(ctx.orgId, id, patch, ctx.actor)
    return apiSuccess({ product })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[products-update-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── DELETE ──────────────────────────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    await deleteProduct(ctx.orgId, id, ctx.actor)
    return apiSuccess({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) {
      return apiError('Not found', 404)
    }
    console.error('[products-delete-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
