// app/api/v1/ads/tiktok/oauth/callback/route.ts
//
// TikTok-specific OAuth callback for the Ads module (Sub-3c). Mirrors the
// LinkedIn callback at /api/v1/ads/linkedin/oauth/callback.
// Key TikTok differences:
//   - Query param is `auth_code` (not `code`)
//   - exchangeCode takes `authCode` (not `code`)
//   - advertiserIds from the token response are persisted in meta.tiktok
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { createConnection, updateConnection } from '@/lib/ads/connections/store'
import { TIKTOK_ADS_SCOPES } from '@/lib/ads/providers/tiktok/constants'
import { exchangeCode } from '@/lib/ads/providers/tiktok/oauth'

const STATE_COLLECTION = 'ad_oauth_states'

function redirect(args: {
  appBase: string
  orgSlug?: string | null
  status: 'connected' | 'error'
  message?: string
  connectionId?: string
}) {
  const base = args.orgSlug
    ? `${args.appBase}/admin/org/${args.orgSlug}/ads/connections`
    : `${args.appBase}/admin/ads/connections`
  const u = new URL(base)
  u.searchParams.set('status', args.status)
  if (args.message) u.searchParams.set('message', args.message)
  if (args.connectionId) u.searchParams.set('connectionId', args.connectionId)
  return NextResponse.redirect(u.toString(), { status: 302 })
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin

  const url = new URL(req.url)
  // TikTok returns `auth_code`, not `code`
  const authCode = url.searchParams.get('auth_code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) return redirect({ appBase, status: 'error', message: errorParam })
  if (!authCode || !state) return redirect({ appBase, status: 'error', message: 'missing_auth_code_or_state' })

  // 1. Verify state
  const stateDoc = await adminDb.collection(STATE_COLLECTION).doc(state).get()
  if (!stateDoc.exists) return redirect({ appBase, status: 'error', message: 'invalid_state' })

  const sd = stateDoc.data() as {
    orgId: string
    platform: string
    redirectUri: string
    expiresAt: { toMillis: () => number }
    orgSlug?: string
  }
  if (sd.platform !== 'tiktok' || sd.expiresAt.toMillis() < Date.now()) {
    return redirect({ appBase, status: 'error', message: 'expired_or_mismatched_state' })
  }
  await adminDb.collection(STATE_COLLECTION).doc(state).delete()

  try {
    // 2. Exchange auth_code for tokens
    const tokens = await exchangeCode({ authCode })

    // 3. Persist via createConnection
    const conn = await createConnection({
      orgId: sd.orgId,
      platform: 'tiktok',
      userId: 'unknown', // TikTok user identity discovery deferred — use listAdvertisers
      scopes: [...TIKTOK_ADS_SCOPES],
      accessToken: tokens.accessToken,
      expiresInSeconds: tokens.expiresInSeconds,
      adAccounts: [],
    })

    // 4. Persist advertiserIds + optional refreshToken expiry in meta.tiktok
    const metaTiktok: Record<string, unknown> = {
      advertiserIds: tokens.advertiserIds,
    }
    if (tokens.refreshToken && tokens.refreshTokenExpiresInSeconds) {
      const { Timestamp } = await import('firebase-admin/firestore')
      metaTiktok.refreshTokenExpiresAt = Timestamp.fromMillis(
        Date.now() + tokens.refreshTokenExpiresInSeconds * 1000,
      )
    }
    if (tokens.scope) {
      metaTiktok.tokenScope = tokens.scope
    }

    await updateConnection(conn.id, { meta: { tiktok: metaTiktok } })

    return redirect({
      appBase,
      orgSlug: sd.orgSlug ?? null,
      status: 'connected',
      connectionId: conn.id,
    })
  } catch (err) {
    const message = (err as Error).message.slice(0, 200)
    return redirect({
      appBase,
      orgSlug: sd.orgSlug ?? null,
      status: 'error',
      message: encodeURIComponent(message),
    })
  }
}
