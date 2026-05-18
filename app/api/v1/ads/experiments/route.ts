// app/api/v1/ads/experiments/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listExperiments, createExperiment } from '@/lib/ads/experiments/store'
import type { CreateExperimentInput, ExperimentStatus } from '@/lib/ads/experiments/types'
import type { AdPlatform } from '@/lib/ads/types'
import { isAdPlatform } from '@/lib/ads/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const status = url.searchParams.get('status') as ExperimentStatus | null
  const platform = url.searchParams.get('platform')
  const includeArchived = url.searchParams.get('includeArchived') === '1'

  const experiments = await listExperiments({
    orgId,
    status: status ?? undefined,
    platform: platform && isAdPlatform(platform) ? (platform as AdPlatform) : undefined,
    includeArchived,
  })
  return apiSuccess({ experiments })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  let body: { input?: CreateExperimentInput }
  try { body = await req.json() } catch { return apiError('Invalid JSON body', 400) }
  if (!body.input) return apiError('Missing input', 400)

  const { input } = body
  if (!input.name || !input.level || !input.parentEntityId || !input.sourceEntityId || !input.platform || !input.variants || !input.successMetric) {
    return apiError('Missing required fields: name, level, parentEntityId, sourceEntityId, platform, variants, successMetric', 400)
  }

  try {
    const experiment = await createExperiment({
      orgId,
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      input,
    })
    return apiSuccess(experiment, 201)
  } catch (err) {
    return apiError((err as Error).message ?? 'Create failed', 400)
  }
})
