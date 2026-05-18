// lib/ads/providers/tiktok/oauth.ts
import {
  TIKTOK_OAUTH_AUTHORIZE_URL,
  TIKTOK_OAUTH_TOKEN_URL,
  TIKTOK_ADS_SCOPES,
} from './constants'

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

/** Build TikTok ads OAuth authorize URL. Uses `app_id` not `client_id`, `auth_code` returned not `code`. */
export function buildAuthorizeUrl(args: {
  redirectUri: string
  state: string
  /** Random id required by TikTok — use crypto.randomUUID() at caller */
  rid: string
}): string {
  const appId = requireEnv('TIKTOK_ADS_CLIENT_ID')
  const u = new URL(TIKTOK_OAUTH_AUTHORIZE_URL)
  u.searchParams.set('app_id', appId)
  u.searchParams.set('redirect_uri', args.redirectUri)
  u.searchParams.set('state', args.state)
  u.searchParams.set('rid', args.rid)
  u.searchParams.set('scope', TIKTOK_ADS_SCOPES.join(','))
  return u.toString()
}

export interface TiktokTokenResponse {
  accessToken: string
  refreshToken?: string
  expiresInSeconds: number
  refreshTokenExpiresInSeconds?: number
  /** Advertiser IDs the granting user has access to */
  advertiserIds: string[]
  scope?: string[]
}

interface TiktokEnvelope<T> {
  code: number
  message: string
  data: T
}

/** Exchange OAuth `auth_code` for tokens. */
export async function exchangeCode(args: { authCode: string }): Promise<TiktokTokenResponse> {
  const appId = requireEnv('TIKTOK_ADS_CLIENT_ID')
  const secret = requireEnv('TIKTOK_ADS_CLIENT_SECRET')

  const body = new URLSearchParams({
    app_id: appId,
    secret,
    auth_code: args.authCode,
  })

  const res = await fetch(TIKTOK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok token exchange HTTP ${res.status} — ${text.slice(0, 200)}`)
  }

  const env = (await res.json()) as TiktokEnvelope<{
    access_token: string
    refresh_token?: string
    expires_in: number
    refresh_token_expires_in?: number
    advertiser_ids?: string[]
    scope?: string[] | string
    token_type?: string
  }>

  if (env.code !== 0) {
    throw new Error(`TikTok token exchange failed: code=${env.code} message=${env.message}`)
  }

  const scope = Array.isArray(env.data.scope)
    ? env.data.scope
    : (typeof env.data.scope === 'string' ? env.data.scope.split(',') : undefined)

  return {
    accessToken: env.data.access_token,
    refreshToken: env.data.refresh_token,
    expiresInSeconds: env.data.expires_in,
    refreshTokenExpiresInSeconds: env.data.refresh_token_expires_in,
    advertiserIds: env.data.advertiser_ids ?? [],
    scope,
  }
}

/** Refresh access token. */
export async function refreshToken(args: { refreshToken: string }): Promise<TiktokTokenResponse> {
  const appId = requireEnv('TIKTOK_ADS_CLIENT_ID')
  const secret = requireEnv('TIKTOK_ADS_CLIENT_SECRET')

  const body = new URLSearchParams({
    app_id: appId,
    secret,
    refresh_token: args.refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch(TIKTOK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok refresh HTTP ${res.status} — ${text.slice(0, 200)}`)
  }

  const env = (await res.json()) as TiktokEnvelope<{
    access_token: string
    refresh_token?: string
    expires_in: number
    refresh_token_expires_in?: number
    advertiser_ids?: string[]
    scope?: string[] | string
  }>

  if (env.code !== 0) {
    throw new Error(`TikTok refresh failed: code=${env.code} message=${env.message}`)
  }

  const scope = Array.isArray(env.data.scope)
    ? env.data.scope
    : (typeof env.data.scope === 'string' ? env.data.scope.split(',') : undefined)

  return {
    accessToken: env.data.access_token,
    refreshToken: env.data.refresh_token,
    expiresInSeconds: env.data.expires_in,
    refreshTokenExpiresInSeconds: env.data.refresh_token_expires_in,
    advertiserIds: env.data.advertiser_ids ?? [],
    scope,
  }
}
