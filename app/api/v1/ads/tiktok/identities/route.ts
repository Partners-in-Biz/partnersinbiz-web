// app/api/v1/ads/tiktok/identities/route.ts
// GET /api/v1/ads/tiktok/identities
// Lists TikTok identities for the connected advertiser, upserts each into ad_identities,
// and returns the canonical AdIdentity list.
// Sub-3c TikTok Phase 2 Batch 3A.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const conn = await getConnection({ orgId, platform: 'tiktok' })
  if (!conn) return apiError('No TikTok ads connection for org', 400)
  const accessToken = decryptAccessToken(conn)
  const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
  const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
  if (!advertiserId) return apiError('No advertiserId set on TikTok connection', 400)

  try {
    const { listIdentities: tiktokListIdentities } = await import('@/lib/ads/providers/tiktok/identities')
    const records = await tiktokListIdentities({ advertiserId, accessToken })

    const { upsertIdentity } = await import('@/lib/ads/identities/store')
    const persisted = await Promise.all(
      records.map((r) =>
        upsertIdentity({
          orgId,
          platform: 'tiktok',
          accountId: advertiserId,
          identityId: r.identityId,
          identityType: r.identityType,
          displayName: r.displayName,
          profileImageUrl: r.profileImageUrl,
        }),
      ),
    )
    return apiSuccess({ identities: persisted })
  } catch (err) {
    return apiError((err as Error).message ?? 'List identities failed', 500)
  }
})
