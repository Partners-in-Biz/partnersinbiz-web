/**
 * GET    /api/v1/crm/pipelines/:id  → viewer+
 * PUT    /api/v1/crm/pipelines/:id  → admin+  (full update)
 * PATCH  /api/v1/crm/pipelines/:id  → admin+  (partial update)
 * DELETE /api/v1/crm/pipelines/:id  → admin+  (soft delete; 400 if live deals attached)
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { NextRequest } from 'next/server'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  loadPipeline,
  assertStagesValid,
  sanitizePipelineForWrite,
} from '@/lib/pipelines/store'
import { PipelineValidationError } from '@/lib/pipelines/types'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

type RouteCtx = { params: Promise<{ id: string }> }

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const loaded = await loadPipeline(id, ctx.orgId)
  if (!loaded) return apiError('Pipeline not found', 404)
  return apiSuccess({ pipeline: loaded.data })
})

// ── PUT / PATCH (shared logic) ────────────────────────────────────────────────

async function handleUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
) {
  const { id } = await routeCtx!.params

  let body: Partial<Pipeline>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (!body || Object.keys(body).length === 0) return apiError('Empty body', 400)

  const loaded = await loadPipeline(id, ctx.orgId)
  if (!loaded) return apiError('Pipeline not found', 404)

  // Name length guard
  if (body.name !== undefined && body.name.trim().length > 100) {
    return apiError('name must be 100 characters or fewer', 400)
  }

  // Stage validation if stages are being updated
  if (body.stages !== undefined) {
    try {
      assertStagesValid(body.stages)
    } catch (err) {
      if (err instanceof PipelineValidationError) {
        return apiError('Stage validation failed', 400, { details: err.details })
      }
      throw err
    }

    // Check if any existing stage IDs are being removed AND have live deals
    const existingStageIds = new Set(loaded.data.stages.map((s: PipelineStage) => s.id))
    const newStageIds = new Set(body.stages.map((s: PipelineStage) => s.id))
    const removedStageIds = [...existingStageIds].filter((sid) => !newStageIds.has(sid))

    for (const removedStageId of removedStageIds) {
      // Count deals in this stage for the pipeline
      const dealsSnap = await adminDb
        .collection('deals')
        .where('orgId', '==', ctx.orgId)
        .where('pipelineId', '==', id)
        .where('stageId', '==', removedStageId)
        .where('deleted', '!=', true)
        .limit(1)
        .get()

      if (!dealsSnap.empty) {
        // Count more precisely
        const countSnap = await adminDb
          .collection('deals')
          .where('orgId', '==', ctx.orgId)
          .where('pipelineId', '==', id)
          .where('stageId', '==', removedStageId)
          .where('deleted', '!=', true)
          .get()

        return apiError(
          `Cannot remove stage "${removedStageId}" — it has live deals attached`,
          400,
          { stageId: removedStageId, dealCount: countSnap.size },
        )
      }
    }
  }

  const sanitized = sanitizePipelineForWrite(body)

  const now = Timestamp.now()
  const patch: Record<string, unknown> = {
    ...sanitized,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    updatedAt: now,
  }

  if (body.name !== undefined) patch.name = body.name.trim()

  // Strip undefined
  const toWrite = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  )

  await loaded.ref.update(toWrite)

  return apiSuccess({ pipeline: { ...loaded.data, ...toWrite, id } })
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
  const loaded = await loadPipeline(id, ctx.orgId)
  if (!loaded) return apiError('Pipeline not found', 404)

  // Check for live deals attached to this pipeline
  const dealsSnap = await adminDb
    .collection('deals')
    .where('orgId', '==', ctx.orgId)
    .where('pipelineId', '==', id)
    .limit(1)
    .get()

  const activeDealCount = dealsSnap.docs.filter((doc) => {
    const deal = typeof doc.data === 'function'
      ? doc.data() as { orgId?: string; pipelineId?: string; deleted?: boolean }
      : {}
    return deal.orgId === ctx.orgId && deal.pipelineId === id && deal.deleted !== true
  }).length

  if (activeDealCount > 0) {
    return apiError('Cannot delete pipeline with live deals attached', 400, {
      dealCount: activeDealCount,
    })
  }

  await loaded.ref.update({
    deleted: true,
    updatedAt: Timestamp.now(),
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
  })

  return apiSuccess({ id })
})
