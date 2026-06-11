// lib/integrations/google_ads/oauth.ts
//
// Google OAuth2 flow for the Google Ads API. Implements `beginOAuth` /
// `completeOAuth` halves of the IntegrationAdapter contract.
//
// Same shape as the other Google adapters — server-side authorization-code
// flow with `access_type=offline` + `prompt=consent` so we always receive a
// long-lived refresh token (Google only returns one on initial consent).
//
// In addition to the OAuth tokens, every Google Ads API call needs a static
// `developer-token` header that the Partners in Biz workspace owns; the
// adapter reads that from `process.env.GOOGLE_ADS_DEVELOPER_TOKEN` at call
// time. Optionally, when the customer is owned by a manager account, a
// `login-customer-id` header is required — read from
// `process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

import type { Connection } from '@/lib/integrations/types'
import { upsertConnection } from '@/lib/integrations/connections'
import type {
  GoogleAdsConnectionMeta,
  GoogleAdsCredentials,
  GoogleTokenResponse,
} from './schema'

/* Constants ──────────────────────────────────────────────────────────── */

export const GOOGLE_AUTHORIZE_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v17'

export const GOOGLE_ADS_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
] as const

/* Env helpers ────────────────────────────────────────────────────────── */

interface GoogleOAuthEnv {
  clientId: string
  clientSecret: string
}

function readOAuthEnv(): GoogleOAuthEnv | null {
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

/** Read the platform-wide developer token. Required on every Ads API call. */
export function readDeveloperToken(): string | null {
  const v = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  return v && v.length > 0 ? v : null
}

/**
 * Read the manager-account `login-customer-id`, if configured. Required only
 * when the connected customer sits under a manager account (which is the
 * common case for agency-managed accounts).
 */
export function readLoginCustomerId(): string | null {
  const v = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim()
  if (!v) return null
  // Strip dashes so callers can copy/paste the standard 'XXX-XXX-XXXX' form.
  const stripped = v.replace(/-/g, '')
  return stripped.length > 0 ? stripped : null
}

/** Strip dashes from a 'XXX-XXX-XXXX' Google Ads customer id. */
export function stripCustomerIdDashes(input: string | undefined | null): string {
  if (!input) return ''
  return input.replace(/-/g, '').trim()
}

/* beginOAuth ────────────────────────────────────────────────────────── */

export interface BeginOAuthInput {
  propertyId: string
  orgId: string
  redirectUri: string
  state: string
}

export interface BeginOAuthResult {
  authorizeUrl: string
}

/**
 * Build the Google authorize URL. We pass `access_type=offline` plus
 * `prompt=consent` so a refresh token is always returned on completion —
 * Google only emits a refresh_token on the user's initial consent.
 */
export async function beginOAuth(input: BeginOAuthInput): Promise<BeginOAuthResult> {
  const env = readOAuthEnv()
  if (!env) {
    // No exception — the registry/UI decides what to do with an empty URL.
    return { authorizeUrl: '' }
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.clientId,
    redirect_uri: input.redirectUri,
    scope: GOOGLE_ADS_SCOPES.join(' '),
    state: input.state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  })

  return {
    authorizeUrl: `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`,
  }
}

/* completeOAuth ─────────────────────────────────────────────────────── */

export interface CompleteOAuthInput {
  propertyId: string
  orgId: string
  code: string
  redirectUri: string
}

/**
 * Exchange an authorization code for tokens and persist a Connection.
 *
 * We do NOT auto-discover the customer id here — the Google Ads API requires
 * the developer token before any call, and most agency setups want the
 * customer id pinned via `Property.config.revenue.googleAdsCustomerId` (so
 * we always know which client the data belongs to). The customer id (and
 * its currency / timezone) are resolved on first pull instead.
 */
export async function completeOAuth(input: CompleteOAuthInput): Promise<Connection> {
  const env = readOAuthEnv()
  if (!env) {
    return upsertConnection({
      propertyId: input.propertyId,
      orgId: input.orgId,
      provider: 'google_ads',
      authKind: 'oauth2',
      credentials: null,
      status: 'error',
      meta: { error: 'GOOGLE_OAUTH_CLIENT_ID/SECRET missing' },
      scope: [...GOOGLE_ADS_SCOPES],
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
      provider: 'google_ads',
      authKind: 'oauth2',
      credentials: null,
      status: 'error',
      meta: { error: 'token_exchange_failed' },
      scope: [...GOOGLE_ADS_SCOPES],
      createdBy: 'system',
      createdByType: 'system',
    })
  }

  const credentials: GoogleAdsCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000,
  }

  const meta: GoogleAdsConnectionMeta = {}
  // If a manager-account login is configured platform-wide, record it on the
  // connection so we don't have to re-read the env at pull time.
  const loginCustomerId = readLoginCustomerId()
  if (loginCustomerId) meta.loginCustomerId = loginCustomerId

  return upsertConnection({
    propertyId: input.propertyId,
    orgId: input.orgId,
    provider: 'google_ads',
    authKind: 'oauth2',
    credentials: credentials as unknown as Record<string, unknown>,
    status: 'connected',
    meta: meta as Record<string, unknown>,
    scope: [...GOOGLE_ADS_SCOPES],
    createdBy: 'system',
    createdByType: 'system',
  })
}

/* Lower-level helpers (also used by client.ts) ───────────────────────── */

export interface CodeExchangeInput {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}

/**
 * POST to Google's token endpoint to exchange `code` for an access+refresh
 * token pair. Returns null on any 4xx/5xx — the caller decides how to
 * surface that.
 */
export async function exchangeCodeForTokens(
  input: CodeExchangeInput,
): Promise<GoogleTokenResponse | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) return null
  return (await res.json()) as GoogleTokenResponse
}

export interface RefreshTokensInput {
  refreshToken: string
  clientId: string
  clientSecret: string
}

/**
 * POST to Google's token endpoint with `grant_type=refresh_token` to get a
 * fresh access token. Returns null on any 4xx/5xx; the caller marks the
 * connection as `reauth_required` if the refresh token itself is dead.
 */
export async function refreshAccessToken(
  input: RefreshTokensInput,
): Promise<GoogleTokenResponse | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) return null
  return (await res.json()) as GoogleTokenResponse
}

/**
 * Revoke an OAuth token (access or refresh). Best-effort — Google returns
 * 200 on success and 400 if the token is already invalid; we treat both as
 * "done" since there's nothing useful to do with the latter.
 */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return
  const body = new URLSearchParams({ token })
  await fetch(GOOGLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}
