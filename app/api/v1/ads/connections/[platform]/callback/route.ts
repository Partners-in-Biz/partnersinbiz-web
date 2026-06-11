// app/api/v1/ads/connections/[platform]/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getProvider } from '@/lib/ads/registry'
import { isAdPlatform } from '@/lib/ads/types'
import { createConnection } from '@/lib/ads/connections/store'
import { META_ADS_SCOPES } from '@/lib/ads/providers/meta/constants'

const STATE_COLLECTION = 'ad_oauth_states'

function resolveScopes(platform: string, tokenScopes?: string[]): string[] {
  if (tokenScopes?.length) return tokenScopes
  if (platform === 'meta') return Array.from(META_ADS_SCOPES)
  return []
}

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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ platform: string }> },
) {
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const { platform } = await ctx.params
  if (!isAdPlatform(platform)) {
    return redirect({ appBase, status: 'error', message: 'unsupported_platform' })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code') ?? url.searchParams.get('auth_code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return redirect({ appBase, status: 'error', message: errorParam })
  }
  if (!code || !state) {
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
  if (sd.platform !== platform || sd.expiresAt.toMillis() < Date.now()) {
    return redirect({ appBase, status: 'error', message: 'expired_or_mismatched_state' })
  }
  // Consume state (single use)
  await adminDb.collection(STATE_COLLECTION).doc(state).delete()

  try {
    const provider = getProvider(platform)
    // 2. Exchange code for short-lived
    const short = await provider.exchangeCodeForToken({
      code,
      redirectUri: sd.redirectUri,
    })
    // 3. Swap to long-lived (~60d for Meta)
    const long = await provider.toLongLivedToken({ accessToken: short.accessToken })
    // 4. Discover ad accounts
    const adAccounts = await provider.listAdAccounts({ accessToken: long.accessToken })
    // 5. Persist
    const conn = await createConnection({
      orgId: sd.orgId,
      platform,
      userId: short.userId ?? 'unknown',
      scopes: resolveScopes(platform, short.scopes),
      accessToken: long.accessToken,
      refreshToken: short.refreshToken,
      expiresInSeconds: long.expiresInSeconds,
      adAccounts,
    })
    return redirect({
      appBase,
      orgSlug: sd.orgSlug ?? null,
      status: 'connected',
      connectionId: conn.id,
    })
  } catch (err) {
    const message = (err as Error).message.slice(0, 200)
    return redirect({ appBase, status: 'error', message: encodeURIComponent(message) })
  }
}
