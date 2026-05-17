// app/api/v1/ads/custom-audiences/[id]/refresh-size/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCustomAudience, updateCustomAudience } from '@/lib/ads/custom-audiences/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import type { AdCustomAudienceStatus } from '@/lib/ads/types'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const { id } = await ctxParams.params
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const ca = await getCustomAudience(id)
    if (!ca || ca.orgId !== orgId) return apiError('Custom audience not found', 404)

    // ─── LinkedIn branch ────────────────────────────────────────────────────
    if (ca.platform === 'linkedin') {
      const conn = await getConnection({ orgId, platform: 'linkedin' })
      if (!conn) return apiError('No LinkedIn ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
      const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
      if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

      const linkedinData = (ca.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const segmentUrn = typeof linkedinData?.dmpSegmentUrn === 'string' ? linkedinData.dmpSegmentUrn : undefined
      if (!segmentUrn) return apiError('Audience has no LinkedIn dmpSegmentUrn', 400)

      const { getAudienceStatus } = await import('@/lib/ads/providers/linkedin/audiences')
      const { status, approximateMemberCount } = await getAudienceStatus({ accountUrn, accessToken, segmentUrn })

      // Map LinkedIn status → canonical
      const canonicalStatus: AdCustomAudienceStatus =
        status === 'READY' ? 'READY' :
        status === 'BUILDING' ? 'BUILDING' :
        status === 'ARCHIVED' ? 'ARCHIVED' :
        'BUILDING'

      await updateCustomAudience(ca.id, {
        status: canonicalStatus,
        approximateSize: approximateMemberCount ?? ca.approximateSize,
      })

      return apiSuccess({ status: canonicalStatus, memberCount: approximateMemberCount })
    }

    // ─── Meta branch (existing, unchanged) ─────────────────────────────────
    const metaCaId = ca.providerData?.meta?.customAudienceId
    if (!metaCaId) return apiError('Custom audience not yet synced to Meta', 400)

    const ctx = await requireMetaContext(req)
    if (ctx instanceof Response) return ctx

    const remote = (await metaProvider.customAudienceCRUD!({
      op: 'get',
      accessToken: ctx.accessToken,
      metaCaId,
    })) as { approximate_count_lower_bound?: number; operation_status?: { code: number } }

    const approximateSize = remote.approximate_count_lower_bound
    let newStatus: AdCustomAudienceStatus
    if (approximateSize == null) {
      newStatus = 'BUILDING'
    } else if (approximateSize === 0) {
      newStatus = 'EMPTY'
    } else if (approximateSize < 1000) {
      newStatus = 'TOO_SMALL'
    } else {
      newStatus = 'READY'
    }

    await updateCustomAudience(id, {
      approximateSize,
      status: newStatus,
    })
    return apiSuccess({ approximateSize, status: newStatus })
  },
)
