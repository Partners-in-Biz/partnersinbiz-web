// app/api/v1/ads/tiktok/oauth/authorize/route.ts
//
// TikTok-specific OAuth authorize endpoint for the Ads module (Sub-3c).
// Mirrors the LinkedIn authorize at /api/v1/ads/linkedin/oauth/authorize.
// TikTok requires an additional `rid` param alongside `state`.
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { buildAuthorizeUrl } from '@/lib/ads/providers/tiktok/oauth'
import { TIKTOK_ADS_REDIRECT_PATH } from '@/lib/ads/providers/tiktok/constants'

const STATE_COLLECTION = 'ad_oauth_states'
const STATE_TTL_MINUTES = 10

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  const orgSlug = req.headers.get('X-Org-Slug') ?? undefined

  const state = crypto.randomBytes(16).toString('hex')
  const rid = crypto.randomUUID()
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${appBase}${TIKTOK_ADS_REDIRECT_PATH}`

  try {
    const authorizeUrl = buildAuthorizeUrl({ redirectUri, state, rid })
    await adminDb.collection(STATE_COLLECTION).doc(state).set({
      state,
      orgId,
      orgSlug,
      platform: 'tiktok',
      redirectUri,
      rid,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MINUTES * 60_000),
    })
    return apiSuccess({ authorizeUrl, state, redirectUri })
  } catch (err) {
    return apiError((err as Error).message || 'Authorize failed', 500)
  }
})
