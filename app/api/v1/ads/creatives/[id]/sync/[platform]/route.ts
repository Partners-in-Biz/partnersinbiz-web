// app/api/v1/ads/creatives/[id]/sync/[platform]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCreative } from '@/lib/ads/creatives/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { isAdPlatform } from '@/lib/ads/types'
import { getProvider } from '@/lib/ads/registry'
import { NotImplementedError } from '@/lib/ads/provider'

export const POST = withAuth(
  'admin',
  async (
    req: NextRequest,
    _user: unknown,
    ctxParams: { params: Promise<{ id: string; platform: string }> },
  ) => {
    const { id, platform } = await ctxParams.params

    if (!isAdPlatform(platform)) return apiError(`Unsupported platform: ${platform}`, 400)

    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const c = await getCreative(id)
    if (!c || c.orgId !== orgId) return apiError('Creative not found', 404)

    if (platform !== 'meta') {
      // Phase 3 only wires Meta; other platforms throw NotImplementedError
      return apiError(`Platform ${platform} sync not implemented yet`, 501)
    }

    if (c.approvalStatus !== 'approved' || (!c.approvalTaskId && !c.approvalDocumentId && !c.approvalCommentId)) {
      return apiError('Creative must have approved paid-media approval evidence before platform sync', 403)
    }

    const ctx = await requireMetaContext(req)
    if (ctx instanceof Response) return ctx

    try {
      const provider = getProvider('meta')
      const result = await provider.syncCreative!({
        orgId,
        adAccountId: ctx.adAccountId,
        accessToken: ctx.accessToken,
        creative: c,
      })
      return apiSuccess({
        platform: 'meta',
        creativeId: (result as { metaCreativeId: string }).metaCreativeId,
        alreadySynced: (result as { alreadySynced: boolean }).alreadySynced,
      })
    } catch (err) {
      if (err instanceof NotImplementedError) return apiError(err.message, 501)
      throw err
    }
  },
)
