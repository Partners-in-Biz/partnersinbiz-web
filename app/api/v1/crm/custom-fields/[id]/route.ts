/**
 * GET    /api/v1/crm/custom-fields/:id  → viewer+
 * PUT    /api/v1/crm/custom-fields/:id  → admin+  (full update)
 * PATCH  /api/v1/crm/custom-fields/:id  → admin+  (partial update)
 * DELETE /api/v1/crm/custom-fields/:id  → admin+  (soft delete)
 */
import { Timestamp } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  loadDefinition,
  sanitizeDefinitionForWrite,
  CustomFieldKeyError,
} from '@/lib/customFields/store'
import type { CustomFieldDefinition, CustomFieldType } from '@/lib/customFields/types'

type RouteCtx = { params: Promise<{ id: string }> }

const OPTION_TYPES = new Set<CustomFieldType>(['dropdown', 'multi_select'])

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const loaded = await loadDefinition(id, ctx.orgId)
  if (!loaded) return apiError('Custom field definition not found', 404)
  return apiSuccess({ definition: loaded.data })
})

// ── PUT / PATCH (shared logic) ────────────────────────────────────────────────

async function handleUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
) {
  const { id } = await routeCtx!.params

  let body: Partial<CustomFieldDefinition>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (Object.keys(body).length === 0) return apiError('Empty body', 400)

  const loaded = await loadDefinition(id, ctx.orgId)
  if (!loaded) return apiError('Custom field definition not found', 404)

  // Reject type change
  if (body.type !== undefined && body.type !== loaded.data.type) {
    return apiError('type is immutable; create a new definition instead', 400)
  }

  // Reject key change
  if (body.key !== undefined && body.key !== loaded.data.key) {
    return apiError('key is immutable; create a new definition instead', 400)
  }

  // Validate options if present and type supports them
  const effectiveType = loaded.data.type
  if (body.options !== undefined && OPTION_TYPES.has(effectiveType)) {
    if (!Array.isArray(body.options) || body.options.length === 0) {
      return apiError('options must be non-empty for dropdown and multi_select fields', 400)
    }
    const values = body.options.map((o) => o.value)
    if (new Set(values).size !== values.length) {
      return apiError('options values must be unique', 400)
    }
  }

  // Sanitize (strips NEVER_FROM_BODY, validates key regex if present)
  let sanitized: Record<string, unknown>
  try {
    sanitized = sanitizeDefinitionForWrite(body)
  } catch (err) {
    if (err instanceof CustomFieldKeyError) return apiError(`Invalid key: ${err.message}`, 400)
    throw err
  }

  const now = Timestamp.now()
  const patch: Record<string, unknown> = {
    ...sanitized,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    updatedAt: now,
  }

  // Strip undefined values
  const toWrite = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  )

  await loaded.ref.update(toWrite)

  return apiSuccess({ definition: { ...loaded.data, ...toWrite, id } })
}

export const PUT = withCrmAuth<RouteCtx>('admin', (req, ctx, routeCtx) =>
  handleUpdate(req, ctx, routeCtx),
)

export const PATCH = withCrmAuth<RouteCtx>('admin', (req, ctx, routeCtx) =>
  handleUpdate(req, ctx, routeCtx),
)

// ── DELETE ────────────────────────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const loaded = await loadDefinition(id, ctx.orgId)
  if (!loaded) return apiError('Custom field definition not found', 404)

  await loaded.ref.update({
    deleted: true,
    updatedAt: Timestamp.now(),
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
  })

  return apiSuccess({ id })
})
