import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import {
  browsePartnerCatalog,
  listPublishedCatalog,
  publishCatalogItem,
} from '@/lib/partner-links/trade'

export const dynamic = 'force-dynamic'

/**
 * GET  ?view=published|browse&relationshipId=…
 *   published — what I (supplier) have published to a partner
 *   browse    — what a partner (supplier) has published to me
 * POST { relationshipId, productId, unitPrice? } — publish / re-price
 */
export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const view = cleanString(req.nextUrl.searchParams.get('view')) || 'published'
    const relationshipId = cleanString(req.nextUrl.searchParams.get('relationshipId'))

    if (view === 'browse') {
      if (!relationshipId) return apiError('relationshipId is required to browse a catalogue', 400)
      const result = await browsePartnerCatalog({ buyerOrgId: ctx.orgId, relationshipId })
      return apiSuccess(result)
    }

    const items = await listPublishedCatalog({
      supplierOrgId: ctx.orgId,
      relationshipId: relationshipId || undefined,
    })
    return apiSuccess({ items })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const relationshipId = cleanString(body.relationshipId)
    const productId = cleanString(body.productId)
    if (!relationshipId) return apiError('relationshipId is required', 400)
    if (!productId) return apiError('productId is required', 400)

    const rawPrice = body.unitPrice
    const unitPrice = rawPrice === undefined || rawPrice === null || rawPrice === ''
      ? undefined
      : Number(rawPrice)
    if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      return apiError('unitPrice must be a number of zero or more', 400)
    }

    const item = await publishCatalogItem({
      supplierOrgId: ctx.orgId,
      relationshipId,
      productId,
      unitPrice,
      actor: ctx.actor,
    })
    return apiSuccess({ item }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
