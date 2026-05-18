// app/api/v1/ads/google/audiences/browse/route.ts
// GET endpoint for listing predefined Google Ads audiences (Affinity, In-Market, Detailed Demographics).
// Sub-3a Phase 5 Batch 3 E

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'

export const dynamic = 'force-dynamic'

const VALID_TYPES = ['AFFINITY', 'IN_MARKET', 'DETAILED_DEMOGRAPHICS'] as const
type BrowseType = (typeof VALID_TYPES)[number]

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const type = url.searchParams.get('type') as BrowseType | null
  if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
    return apiError('type must be AFFINITY, IN_MARKET, or DETAILED_DEMOGRAPHICS', 400)
  }

  const conn = await getConnection({ orgId, platform: 'google' })
  if (!conn) return apiError('No Google Ads connection', 400)

  const accessToken = decryptAccessToken(conn)
  const developerToken = readDeveloperToken()
  if (!developerToken) return apiError('GOOGLE_ADS_DEVELOPER_TOKEN not configured', 500)

  const customerCtx = resolveGoogleAdsCustomerContext(conn)
  if (customerCtx instanceof Response) return customerCtx

  const callArgs = { ...customerCtx, accessToken, developerToken }

  try {
    let audiences
    if (type === 'AFFINITY') {
      const { listAffinityAudiences } = await import('@/lib/ads/providers/google/audiences/browse-predefined')
      audiences = await listAffinityAudiences(callArgs)
    } else if (type === 'IN_MARKET') {
      const { listInMarketAudiences } = await import('@/lib/ads/providers/google/audiences/browse-predefined')
      audiences = await listInMarketAudiences(callArgs)
    } else {
      const { listDetailedDemographics } = await import('@/lib/ads/providers/google/audiences/browse-predefined')
      audiences = await listDetailedDemographics(callArgs)
    }
    return apiSuccess({ audiences })
  } catch (err) {
    return apiError((err as Error).message ?? 'Browse failed', 500)
  }
})
