// app/api/v1/ads/google/oauth/callback/route.ts
//
// Google-specific OAuth callback for the Ads module (Sub-3a). Mirrors the
// Meta callback at `app/api/v1/ads/connections/[platform]/callback/route.ts`
// but lives on a Google-namespaced path so the Google flow can evolve
// independently (developer-token handling, MCC login-customer-id, customer
// discovery via `customers:listAccessibleCustomers`).
//
// On success the user is redirected to
// `/admin/org/{orgSlug}/ads/connections` — NOT `/admin/ads/connections`.
// Sub-1 Phase 1's final review caught a bug where the callback redirected
// to the latter non-existent path; do not repeat that here.
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { createConnection } from '@/lib/ads/connections/store'
import { GOOGLE_ADS_SCOPES_FOR_ADS_MODULE } from '@/lib/ads/providers/google/oauth'
import { exchangeCodeForTokens } from '@/lib/integrations/google_ads/oauth'

const STATE_COLLECTION = 'ad_oauth_states'

function redirect(args: {
  appBase: string
  orgSlug?: string | null
  status: 'connected' | 'error'
  message?: string
  connectionId?: string
  needsAccountSelection?: boolean
}) {
  const base = args.orgSlug
    ? `${args.appBase}/admin/org/${args.orgSlug}/ads/connections`
    : `${args.appBase}/admin/ads/connections`
  const u = new URL(base)
  u.searchParams.set('status', args.status)
  u.searchParams.set('provider', 'google')
  if (args.message) u.searchParams.set('message', args.message)
  if (args.connectionId) u.searchParams.set('connectionId', args.connectionId)
  if (args.needsAccountSelection) u.searchParams.set('needsAccountSelection', '1')
  return NextResponse.redirect(u.toString(), { status: 302 })
}

function readOAuthEnv(): { clientId: string; clientSecret: string } | null {
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (oauthClientId && oauthClientSecret) {
    return { clientId: oauthClientId, clientSecret: oauthClientSecret }
  }

  const adsClientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim()
  const adsClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
  if (adsClientId && adsClientSecret) {
    return { clientId: adsClientId, clientSecret: adsClientSecret }
  }

  return null
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (!state || (!code && !errorParam)) {
    return redirect({ appBase, status: 'error', message: 'missing_code_or_state' })
  }

  // 1. Verify state
  const stateDoc = await adminDb.collection(STATE_COLLECTION).doc(state).get()
  if (!stateDoc.exists) {
    return redirect({ appBase, status: 'error', message: 'invalid_state' })
  }
  const sd = stateDoc.data() as {
    orgId: string
    platform: string
    redirectUri: string
    expiresAt: { toMillis: () => number }
    orgSlug?: string
  }
  if (sd.platform !== 'google' || sd.expiresAt.toMillis() < Date.now()) {
    return redirect({ appBase, status: 'error', message: 'expired_or_mismatched_state' })
  }
  // Consume state (single use)
  await adminDb.collection(STATE_COLLECTION).doc(state).delete()

  if (errorParam) {
    return redirect({
      appBase,
      orgSlug: sd.orgSlug ?? null,
      status: 'error',
      message: errorParam,
    })
  }

  if (!code) {
    return redirect({ appBase, orgSlug: sd.orgSlug ?? null, status: 'error', message: 'missing_code_or_state' })
  }

  try {
    const env = readOAuthEnv()
    if (!env) {
      return redirect({
        appBase,
        orgSlug: sd.orgSlug ?? null,
        status: 'error',
        message: 'google_oauth_env_pair_missing',
      })
    }
    const { clientId, clientSecret } = env

    // 2. Exchange code for tokens (Google returns access_token + refresh_token
    //    + expires_in; we don't auto-discover customers here so we don't need
    //    the developer-token yet).
    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri: sd.redirectUri,
      clientId,
      clientSecret,
    })
    if (!tokens) {
      return redirect({
        appBase,
        orgSlug: sd.orgSlug ?? null,
        status: 'error',
        message: 'token_exchange_failed',
      })
    }

    // 3. Persist. We do NOT pre-discover customers — the UI calls
    //    `GET /api/v1/ads/google/customers?connectionId=...` after redirect
    //    to populate the picker (matches Meta's `ad-accounts` discovery
    //    pattern but the developer-token requirement makes it a separate
    //    request rather than a callback-time fetch).
    const tokenScopes = typeof tokens.scope === 'string' && tokens.scope.trim().length > 0
      ? tokens.scope.trim().split(/\s+/)
      : [...GOOGLE_ADS_SCOPES_FOR_ADS_MODULE]

    const conn = await createConnection({
      orgId: sd.orgId,
      platform: 'google',
      userId: 'unknown', // Google doesn't return the user id alongside ads tokens
      scopes: tokenScopes,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in ?? 3600,
      adAccounts: [],
    })

    return redirect({
      appBase,
      orgSlug: sd.orgSlug ?? null,
      status: 'connected',
      connectionId: conn.id,
      needsAccountSelection: true,
    })
  } catch (err) {
    const message = (err as Error).message.slice(0, 200)
    return redirect({
      appBase,
      orgSlug: sd.orgSlug ?? null,
      status: 'error',
      message,
    })
  }
}
