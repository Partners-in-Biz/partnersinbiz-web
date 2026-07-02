// lib/integrations/firebase_analytics/oauth.ts
//
// Firebase Analytics reuses GA4's OAuth client id/secret and scope
// (`analytics.readonly`) verbatim — Firebase Analytics reporting IS the GA4
// Data API against the Firebase-linked GA4 property, so there is no separate
// Firebase OAuth surface to authorize against. This module only re-exposes
// GA4's `beginOAuth` under the `firebase_analytics` provider label and wraps
// `completeOAuth` so the resulting Connection is persisted with
// `provider: 'firebase_analytics'` (a connection doc distinct from `ga4`,
// letting an org connect both a web GA4 property and an app's
// Firebase-linked GA4 property on the same PiB property).

import type { Connection } from '@/lib/integrations/types'
import { upsertConnection } from '@/lib/integrations/connections'
import {
  GA4_SCOPES,
  readEnv,
  beginOAuth as ga4BeginOAuth,
  exchangeCodeForTokens,
  revokeToken,
  type BeginOAuthInput,
  type BeginOAuthResult,
} from '@/lib/integrations/ga4/oauth'
import type { Ga4Credentials } from '@/lib/integrations/ga4/schema'

/** Same scope as GA4 — Firebase Analytics reporting IS GA4 Data API reporting. */
export const FIREBASE_ANALYTICS_SCOPES = GA4_SCOPES

export { readEnv, revokeToken }

/** Build the Google authorize URL. Identical to GA4's — same client, same scope. */
export async function beginOAuth(input: BeginOAuthInput): Promise<BeginOAuthResult> {
  return ga4BeginOAuth(input)
}

export interface CompleteOAuthInput {
  propertyId: string
  orgId: string
  code: string
  redirectUri: string
}

/**
 * Exchange an authorization code for tokens and persist a
 * `firebase_analytics` Connection (separate doc from `ga4`, same token
 * exchange logic).
 */
export async function completeOAuth(input: CompleteOAuthInput): Promise<Connection> {
  const env = readEnv()
  if (!env) {
    return upsertConnection({
      propertyId: input.propertyId,
      orgId: input.orgId,
      provider: 'firebase_analytics',
      authKind: 'oauth2',
      credentials: null,
      status: 'error',
      meta: { error: 'GOOGLE_OAUTH_CLIENT_ID/SECRET missing' },
      scope: [...FIREBASE_ANALYTICS_SCOPES],
      createdBy: 'system',
      createdByType: 'system',
    })
  }

  const tokens = await exchangeCodeForTokens({
    code: input.code,
    redirectUri: input.redirectUri,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  })

  if (!tokens) {
    return upsertConnection({
      propertyId: input.propertyId,
      orgId: input.orgId,
      provider: 'firebase_analytics',
      authKind: 'oauth2',
      credentials: null,
      status: 'error',
      meta: { error: 'token_exchange_failed' },
      scope: [...FIREBASE_ANALYTICS_SCOPES],
      createdBy: 'system',
      createdByType: 'system',
    })
  }

  const credentials: Ga4Credentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000,
  }

  // Meta intentionally left empty here — the user supplies the
  // Firebase-linked GA4 property id via Property.config.revenue
  // (firebaseAnalyticsPropertyId, falling back to ga4PropertyId) in the
  // property settings UI, mirroring the GA4 adapter's convention.
  return upsertConnection({
    propertyId: input.propertyId,
    orgId: input.orgId,
    provider: 'firebase_analytics',
    authKind: 'oauth2',
    credentials: credentials as unknown as Record<string, unknown>,
    status: 'connected',
    meta: {},
    scope: [...FIREBASE_ANALYTICS_SCOPES],
    createdBy: 'system',
    createdByType: 'system',
  })
}
