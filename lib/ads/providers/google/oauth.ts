// lib/ads/providers/google/oauth.ts
//
// Thin OAuth wrapper for the Google Ads provider inside the ads module.
// The real implementation lives in the analytics adapter at
// `lib/integrations/google_ads/oauth.ts`; we re-export its functions under
// ads-module-friendly aliases so both modules share the SAME Google OAuth
// app credentials (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).

import { GOOGLE_ADS_SCOPES_FOR_ADS_MODULE } from './constants'

// Re-export constants the OAuth wrapper consumers may also want, so callers
// only need to import from one place.
export { GOOGLE_ADS_SCOPES_FOR_ADS_MODULE } from './constants'

function requireOAuthClientId(): string {
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const adsClientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim()
  const adsClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()

  const v = oauthClientId && oauthClientSecret
    ? oauthClientId
    : adsClientId && adsClientSecret
      ? adsClientId
      : undefined

  if (!v) throw new Error(`Missing env var pair: GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET or GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET`)
  return v
}

export function buildAdsAuthorizeUrl(args: {
  redirectUri: string
  state: string
  orgId: string
}): string {
  // Same env var the analytics adapter reads — see
  // `lib/integrations/google_ads/oauth.ts` `readOAuthEnv()`.
  const clientId = requireOAuthClientId()
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', args.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_ADS_SCOPES_FOR_ADS_MODULE.join(' '))
  u.searchParams.set('state', args.state)
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  return u.toString()
}

// `revokeToken` takes a single token string and has no shape mismatch with
// the ads module's needs, so we re-export it directly.
export { revokeToken as revokeAdsToken } from '@/lib/integrations/google_ads/oauth'

import {
  exchangeCodeForTokens,
  refreshAccessToken,
} from '@/lib/integrations/google_ads/oauth'

function requireOAuthEnvPair(): { clientId: string; clientSecret: string } {
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
  throw new Error(
    'Missing env var: GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET or GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET',
  )
}

/**
 * Exchange an authorization code for tokens, shaped to the AdProvider
 * `exchangeCodeForToken` contract. Wraps the analytics adapter's
 * `exchangeCodeForTokens` so the ads + analytics modules sign the swap
 * identically and cannot drift.
 */
export async function exchangeAdsCodeForToken(args: {
  code: string
  redirectUri: string
}): Promise<{
  accessToken: string
  expiresInSeconds: number
  refreshToken?: string
  scopes?: string[]
}> {
  const { clientId, clientSecret } = requireOAuthEnvPair()
  const tokens = await exchangeCodeForTokens({
    code: args.code,
    redirectUri: args.redirectUri,
    clientId,
    clientSecret,
  })
  if (!tokens) throw new Error('Google token exchange failed')
  const scopes =
    typeof tokens.scope === 'string' && tokens.scope.trim().length > 0
      ? tokens.scope.trim().split(/\s+/)
      : undefined
  return {
    accessToken: tokens.access_token,
    expiresInSeconds: tokens.expires_in ?? 3600,
    refreshToken: tokens.refresh_token,
    scopes,
  }
}

/**
 * Mint a fresh access token from a stored refresh token, shaped to the
 * AdProvider `refreshToken` contract.
 */
export async function refreshAdsAccessToken(args: {
  refreshToken: string
}): Promise<{
  accessToken: string
  expiresInSeconds: number
  refreshToken?: string
}> {
  const { clientId, clientSecret } = requireOAuthEnvPair()
  const tokens = await refreshAccessToken({
    refreshToken: args.refreshToken,
    clientId,
    clientSecret,
  })
  if (!tokens) throw new Error('Google token refresh failed')
  return {
    accessToken: tokens.access_token,
    expiresInSeconds: tokens.expires_in ?? 3600,
    // Google does not re-issue a refresh token on refresh; carry the existing
    // one forward so the connection keeps a usable refresh token.
    refreshToken: tokens.refresh_token ?? args.refreshToken,
  }
}
