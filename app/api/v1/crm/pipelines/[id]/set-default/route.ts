/**
 * POST /api/v1/crm/pipelines/:id/set-default  → admin+
 *
 * Atomically clears isDefault on any other pipeline for the org,
 * then sets isDefault=true on this pipeline.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { loadPipeline, clearOtherDefaults } from '@/lib/pipelines/store'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const loaded = await loadPipeline(id, ctx.orgId)
  if (!loaded) return apiError('Pipeline not found', 404)

  // Clear all other defaults first (best-effort atomic)
  await clearOtherDefaults(ctx.orgId, id)

  const now = Timestamp.now()
  const updateFields: Record<string, unknown> = {
    isDefault: true,
    updatedAt: now,
    updatedByRef: ctx.actor,
  }
  if (!ctx.isAgent) updateFields.updatedBy = ctx.actor.uid

  await loaded.ref.update(updateFields)

  return apiSuccess({
    pipeline: { ...loaded.data, isDefault: true },
  })
})
