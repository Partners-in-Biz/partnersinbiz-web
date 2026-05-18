// app/api/v1/ads/experiments/[id]/declare-winner/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getExperiment, updateExperimentStatus } from '@/lib/ads/experiments/store'
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
    if (experiment.status !== 'running') return apiError('Experiment must be running to declare a winner', 400)
    if (!experiment.significance) return apiError('Significance not yet computed — call /compute first', 400)

    let body: { variantId?: string } = {}
    try {
      const raw = await req.text()
      if (raw) body = JSON.parse(raw)
    } catch { /* body is optional */ }

    const winnerVariantId = body.variantId ?? experiment.significance.winnerVariantId
    if (!winnerVariantId) return apiError('No winner variant id provided or computed', 400)

    // Verify the winner variant exists
    const winnerVariant = experiment.variants.find((v) => v.id === winnerVariantId)
    if (!winnerVariant) return apiError(`Variant ${winnerVariantId} not found in experiment`, 400)

    // Pause all non-winning variants' underlying entities
    const entityCollection = experiment.level === 'adset' ? 'ad_sets' : 'ads'
    const pauseOps = experiment.variants
      .filter((v) => v.id !== winnerVariantId && v.entityId)
      .map((v) =>
        adminDb.collection(entityCollection).doc(v.entityId!).update({
          status: 'PAUSED',
          updatedAt: Timestamp.now(),
        })
      )
    await Promise.all(pauseOps)

    // Flip experiment to winner_declared
    await updateExperimentStatus(id, 'winner_declared', {
      declaredWinnerVariantId: winnerVariantId,
      endedAt: Timestamp.now(),
    })

    const updated = await getExperiment(id)
    return apiSuccess(updated)
  },
)
