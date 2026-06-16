// lib/ads/providers/google/constants.ts
//
// Constants for the Google Ads provider inside the ads module. Sources of
// truth (API base + scopes) live in the existing analytics adapter at
// `lib/integrations/google_ads/oauth.ts` — we re-export them here so the
// ads module and the analytics adapter cannot drift.

import {
  GOOGLE_ADS_API_BASE,
  GOOGLE_ADS_SCOPES,
} from '@/lib/integrations/google_ads/oauth'

/** Full Google Ads REST base URL (already includes the API version). */
export const GOOGLE_ADS_API_BASE_URL = GOOGLE_ADS_API_BASE

/** OAuth scopes required for the Google Ads API. */
export const GOOGLE_ADS_SCOPES_FOR_ADS_MODULE = [...GOOGLE_ADS_SCOPES]

/** Callback path the ads-module OAuth flow redirects to. */
export const GOOGLE_ADS_REDIRECT_PATH = '/api/v1/ads/google/oauth/callback'

/** Google Ads API version pinned by the analytics adapter base URL. */
export const GOOGLE_ADS_API_VERSION = 'v21'
