// app/api/v1/ads/experiments/[id]/stop/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getExperiment, updateExperimentStatus } from '@/lib/ads/experiments/store'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params

    const experiment = await getExperiment(id)
    if (!experiment || experiment.orgId !== orgId) return apiError('Experiment not found', 404)
    if (experiment.status !== 'running') return apiError('Experiment must be running to stop', 400)

    await updateExperimentStatus(id, 'paused')
    const updated = await getExperiment(id)
    return apiSuccess(updated)
  },
)
