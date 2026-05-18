// app/api/v1/ads/experiments/[id]/start/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getExperiment, updateExperimentStatus } from '@/lib/ads/experiments/store'
import { generateVariantEntities } from '@/lib/ads/experiments/start'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params

    const experiment = await getExperiment(id)
    if (!experiment || experiment.orgId !== orgId) return apiError('Experiment not found', 404)
    if (experiment.status !== 'draft') return apiError('Experiment must be in draft status to start', 400)

    try {
      // Generate variant entities (duplicates source entity per non-control variant)
      const updated = await generateVariantEntities({ experiment })

      // Persist the populated variants directly — bypass the status guard in updateExperiment
      // (we are still 'draft' here, so this is safe, but we use adminDb directly for clarity)
      await adminDb.collection('ad_experiments').doc(id).update({
        variants: updated.variants,
        updatedAt: Timestamp.now(),
      })

      // Flip status to running
      await updateExperimentStatus(id, 'running', { startedAt: Timestamp.now() })

      const result = await getExperiment(id)
      return apiSuccess(result)
    } catch (err) {
      return apiError((err as Error).message ?? 'Start failed', 400)
    }
  },
)
