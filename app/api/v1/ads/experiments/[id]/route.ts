// app/api/v1/ads/experiments/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getExperiment, updateExperiment, archiveExperiment, listResults } from '@/lib/ads/experiments/store'
import type { UpdateExperimentInput } from '@/lib/ads/experiments/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const experiment = await getExperiment(id)
    if (!experiment || experiment.orgId !== orgId) return apiError('Experiment not found', 404)
    const results = await listResults({ experimentId: id })
    // Return the 20 most recent results
    const recentResults = results
      .sort((a, b) => b.computedAt.seconds - a.computedAt.seconds)
      .slice(0, 20)
    return apiSuccess({ experiment, results: recentResults })
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const experiment = await getExperiment(id)
    if (!experiment || experiment.orgId !== orgId) return apiError('Experiment not found', 404)

    let body: UpdateExperimentInput
    try { body = (await req.json()) as UpdateExperimentInput } catch { return apiError('Invalid JSON body', 400) }

    // Reject variants change when not draft
    if (body.variants !== undefined && experiment.status !== 'draft') {
      return apiError('Variants can only be changed when status=draft', 400)
    }

    try {
      await updateExperiment(id, body)
      const updated = await getExperiment(id)
      return apiSuccess(updated)
    } catch (err) {
      return apiError((err as Error).message ?? 'Update failed', 400)
    }
  },
)

export const DELETE = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const experiment = await getExperiment(id)
    if (!experiment || experiment.orgId !== orgId) return apiError('Experiment not found', 404)
    await archiveExperiment(id)
    return apiSuccess({ archived: true })
  },
)
