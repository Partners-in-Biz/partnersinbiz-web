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

// Re-export the analytics adapter's OAuth functions under ads-module names.
// Note: the analytics adapter exports `refreshAccessToken` (not
// `refreshToken`), so we alias it here as `refreshAdsToken`.
export {
  completeOAuth as exchangeAdsCode,
  refreshAccessToken as refreshAdsToken,
  revokeToken as revokeAdsToken,
} from '@/lib/integrations/google_ads/oauth'
