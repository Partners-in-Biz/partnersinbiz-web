// app/api/v1/ads/campaigns/[id]/validate/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { validateCampaign as metaValidateCampaign } from '@/lib/ads/providers/meta/campaigns'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const campaign = await getCampaign(id)
    if (!campaign || campaign.orgId !== orgId) return apiError('Campaign not found', 404)

    const metaId = (campaign.providerData?.meta as { id?: string } | undefined)?.id
    if (!metaId) {
      // Not yet pushed to Meta — nothing to validate against
      return apiSuccess({
        valid: true,
        warnings: ['Campaign not yet pushed to Meta — nothing to validate against'],
      })
    }

    const ctx = await requireMetaContext(req)
    if (ctx instanceof Response) return ctx

    try {
      await metaValidateCampaign({
        metaCampaignId: metaId,
        accessToken: ctx.accessToken,
        patch: campaign,
      })
      return apiSuccess({ valid: true, warnings: [] })
    } catch (err) {
      return apiSuccess({ valid: false, warnings: [(err as Error).message] })
    }
  },
)
