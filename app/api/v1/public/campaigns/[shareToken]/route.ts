/**
 * GET /api/v1/public/campaigns/[shareToken]  — PUBLIC: read-only campaign share link.
 *
 * No auth. Looks up by shareToken; only returns when shareEnabled === true
 * and the campaign is not deleted. Strips internal-only audit fields.
 */
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { buildCampaignAssets } from '@/lib/campaigns/assets'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ shareToken: string }> }

const STRIP_FIELDS = [
  'createdBy',
  'createdByType',
  'updatedBy',
  'updatedByType',
  'deleted',
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function strip(obj: any) {
  if (!obj || typeof obj !== 'object') return obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if ((STRIP_FIELDS as readonly string[]).includes(k)) continue
    out[k] = v
  }
  return out
}

export async function GET(req: NextRequest, context: Params): Promise<NextResponse> {
  try {
    const { shareToken } = await context.params
    if (!shareToken || shareToken.length < 8) {
      return apiError('Invalid share token', 400)
    }
    const limited = await enforcePublicRateLimit(req, {
      key: `public_campaign:${publicRateLimitHash(shareToken)}:${publicRequestIp(req)}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    })
    if (limited) return limited

    const snap = await adminDb
      .collection('campaigns')
      .where('shareToken', '==', shareToken)
      .limit(1)
      .get()

    if (snap.empty) return apiError('Campaign not found', 404)
    const doc = snap.docs[0]
    const data = doc.data()
    if (data.deleted === true) return apiError('Campaign not found', 404)
    if (data.shareEnabled !== true) return apiError('Share link disabled', 403)

    const assets = await buildCampaignAssets(doc.id)

    // Strip internal-only fields from every asset and the campaign itself.
    const campaign = strip({ id: doc.id, ...data })
    const cleanedAssets = {
      ...assets,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      social: assets.social.map((p: any) => strip(p)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blogs: assets.blogs.map((b: any) => strip(b)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      videos: assets.videos.map((v: any) => strip(v)),
    }

    return apiSuccess({ campaign, assets: cleanedAssets })
  } catch (err) {
    console.error('[public/campaigns]', err)
    return apiError('Internal Server Error', 500)
  }
}
