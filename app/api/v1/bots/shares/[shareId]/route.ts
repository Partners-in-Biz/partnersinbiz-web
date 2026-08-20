/**
 * GET /api/v1/bots/shares/[shareId]
 * Preview a shared custom GrokBot. Never returns apiKey or source computer ids.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canViewBotShare, parseBotShareId, publicBotSharePreview } from '@/lib/messages/bot-shares'
import { getBotShare } from '@/lib/messages/bot-share-store'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ shareId: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { shareId: rawShareId } = await (context as Params).params
    const shareId = parseBotShareId(rawShareId)
    if (!shareId) return apiError('Share not found', 404)
    const share = await getBotShare(shareId)
    if (!share) return apiError('Share not found', 404)
    const viewerOrgId = user.orgId || user.orgIds?.[0] || null
    if (!canViewBotShare(share, { uid: user.uid, orgId: viewerOrgId })) {
      return apiError('Share not found', 404)
    }
    const preview = publicBotSharePreview(share)
    if (!preview) return apiError('Share not found', 404)
    return apiSuccess({ share: preview })
  },
)
