/**
 * GET /api/v1/crm/pipelines/default  → viewer+
 *
 * Returns the org's default pipeline.
 * If none exists AND the caller has write access (member+), bootstraps a
 * default "Sales" pipeline via bootstrapDefaultPipeline and returns it.
 * Otherwise 404.
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getDefaultPipelineForOrg, bootstrapDefaultPipeline } from '@/lib/pipelines/store'

const WRITE_ROLES = new Set(['owner', 'admin', 'member'])

export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  const existing = await getDefaultPipelineForOrg(ctx.orgId)
  if (existing) return apiSuccess({ pipeline: existing })

  // No default — bootstrap if caller has write access (member or above)
  const canWrite = ctx.isAgent || WRITE_ROLES.has(ctx.role)
  if (!canWrite) {
    return apiError('No default pipeline configured', 404)
  }

  const pipeline = await bootstrapDefaultPipeline(ctx.orgId, ctx.actor)
  return apiSuccess({ pipeline })
})
