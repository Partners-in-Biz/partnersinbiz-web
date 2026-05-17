// app/api/v1/ads/linkedin/oauth/authorize/route.ts
//
// LinkedIn-specific OAuth authorize endpoint for the Ads module (Sub-3b).
// Mirrors the Google ads authorize at /api/v1/ads/google/oauth/authorize.
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { buildAuthorizeUrl } from '@/lib/ads/providers/linkedin/oauth'

const STATE_COLLECTION = 'ad_oauth_states'
const STATE_TTL_MINUTES = 10

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  const orgSlug = req.headers.get('X-Org-Slug') ?? undefined

  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/v1/ads/linkedin/oauth/callback`

  try {
    const authorizeUrl = buildAuthorizeUrl({ redirectUri, state })
    await adminDb.collection(STATE_COLLECTION).doc(state).set({
      state,
      orgId,
      orgSlug,
      platform: 'linkedin',
      redirectUri,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MINUTES * 60_000),
    })
    return apiSuccess({ authorizeUrl, state, redirectUri })
  } catch (err) {
    return apiError((err as Error).message || 'Authorize failed', 500)
  }
})
