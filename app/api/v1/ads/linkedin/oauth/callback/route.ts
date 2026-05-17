// app/api/v1/ads/linkedin/oauth/callback/route.ts
//
// LinkedIn-specific OAuth callback for the Ads module (Sub-3b). Mirrors
// the Google callback at /api/v1/ads/google/oauth/callback. Stores the
// access token via createConnection. UI calls /api/v1/ads/linkedin/accounts
// after the callback to populate the ad account picker.
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { createConnection } from '@/lib/ads/connections/store'
import { LINKEDIN_ADS_SCOPES } from '@/lib/ads/providers/linkedin/constants'
import { exchangeCode } from '@/lib/ads/providers/linkedin/oauth'

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
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) return redirect({ appBase, status: 'error', message: errorParam })
  if (!code || !state) return redirect({ appBase, status: 'error', message: 'missing_code_or_state' })

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
  if (sd.platform !== 'linkedin' || sd.expiresAt.toMillis() < Date.now()) {
    return redirect({ appBase, status: 'error', message: 'expired_or_mismatched_state' })
  }
  await adminDb.collection(STATE_COLLECTION).doc(state).delete()

  try {
    // 2. Exchange code for tokens
    const tokens = await exchangeCode({ code, redirectUri: sd.redirectUri })

    // 3. Persist via createConnection
    const conn = await createConnection({
      orgId: sd.orgId,
      platform: 'linkedin',
      userId: 'unknown',  // LinkedIn member URN discovery deferred — UI fetches /accounts
      scopes: [...LINKEDIN_ADS_SCOPES],
      accessToken: tokens.accessToken,
      expiresInSeconds: tokens.expiresInSeconds,
      adAccounts: [],
    })

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
