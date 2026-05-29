/**
 * GET  /api/v1/crm/products — list workspace products (member+)
 * POST /api/v1/crm/products — create product (admin+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listProducts, createProduct } from '@/lib/products/store'
import type { ProductInput } from '@/lib/products/types'

export const dynamic = 'force-dynamic'

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const products = await listProducts(ctx.orgId)
    return apiSuccess({ products })
  } catch (err) {
    console.error('[products-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── POST ────────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

  // Validate required fields
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return apiError('name is required', 400)
  }
  if (body.unitPrice === undefined || body.unitPrice === null || typeof body.unitPrice !== 'number') {
    return apiError('unitPrice is required and must be a number', 400)
  }
  if (!Number.isFinite(body.unitPrice) || body.unitPrice < 0) {
    return apiError('unitPrice must be a non-negative finite number', 400)
  }
  if (!body.currency || typeof body.currency !== 'string' || !body.currency.trim()) {
    return apiError('currency is required', 400)
  }

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

  const input: Partial<ProductInput> = {
    name: (rest.name as string).trim(),
    unitPrice: rest.unitPrice as number,
    currency: (rest.currency as string).trim() as ProductInput['currency'],
    ...(rest.description !== undefined && { description: rest.description as string }),
    ...(rest.unit !== undefined && { unit: rest.unit as string }),
    ...(rest.deleted !== undefined && { deleted: rest.deleted as boolean }),
  }

  try {
    const product = await createProduct(ctx.orgId, input as ProductInput, ctx.actor)
    return apiSuccess({ product }, 201)
  } catch (err) {
    console.error('[products-create-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
