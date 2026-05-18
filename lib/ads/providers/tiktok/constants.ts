// lib/ads/providers/tiktok/constants.ts
//
// TikTok For Business Marketing API constants.
// API version pinned at v1.3 (current as of 2026-05). Update when TikTok
// retires prior versions — they typically support 6-12 months back.

/** TikTok Marketing API base URL. */
export const TIKTOK_ADS_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

/** OAuth authorize URL — note this is on a different host from API calls. */
export const TIKTOK_OAUTH_AUTHORIZE_URL = 'https://business-api.tiktok.com/portal/auth'

/** OAuth token + refresh endpoint. */
export const TIKTOK_OAUTH_TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/'

/**
 * Scopes for the Marketing API. TikTok uses numeric scope codes joined comma-separated.
 * SEPARATE from any existing TikTok-for-posting OAuth (which uses different
 * scopes on a different app). The ads flow needs a dedicated TikTok For
 * Business Marketing API app with its own app_id + secret.
 *
 *   1   — ads read
 *   4   — ads management (create/update campaigns, ad groups, ads)
 *   7   — Events API (server-side conversions)
 *   8   — custom audiences
 *   100 — reporting (insights)
 */
export const TIKTOK_ADS_SCOPES = ['1', '4', '7', '8', '100'] as const
export type TiktokAdsScope = (typeof TIKTOK_ADS_SCOPES)[number]

/** Callback path the ads-module TikTok OAuth flow redirects to. */
export const TIKTOK_ADS_REDIRECT_PATH = '/api/v1/ads/tiktok/oauth/callback'
