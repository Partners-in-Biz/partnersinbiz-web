import {
  LINKEDIN_OAUTH_AUTHORIZE_URL,
  LINKEDIN_OAUTH_TOKEN_URL,
  LINKEDIN_ADS_SCOPES,
} from './constants'

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

/** Build LinkedIn ads OAuth authorize URL. */
export function buildAuthorizeUrl(args: {
  redirectUri: string
  state: string
}): string {
  const clientId = requireEnv('LINKEDIN_ADS_CLIENT_ID')
  const u = new URL(LINKEDIN_OAUTH_AUTHORIZE_URL)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', args.redirectUri)
  u.searchParams.set('scope', LINKEDIN_ADS_SCOPES.join(' '))
  u.searchParams.set('state', args.state)
  return u.toString()
}

export interface LinkedinTokenResponse {
  accessToken: string
  refreshToken?: string  // LinkedIn refresh tokens only return when scope includes it; check 'r_basicprofile' or similar
  expiresInSeconds: number
  refreshTokenExpiresInSeconds?: number
  scope?: string
}

/** Exchange OAuth code for tokens. */
export async function exchangeCode(args: {
  code: string
  redirectUri: string
}): Promise<LinkedinTokenResponse> {
  const clientId = requireEnv('LINKEDIN_ADS_CLIENT_ID')
  const clientSecret = requireEnv('LINKEDIN_ADS_CLIENT_SECRET')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(LINKEDIN_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn token exchange failed: HTTP ${res.status} — ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    refresh_token_expires_in?: number
    scope?: string
    token_type?: string
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSeconds: data.expires_in,
    refreshTokenExpiresInSeconds: data.refresh_token_expires_in,
    scope: data.scope,
  }
}

/** Refresh an access token using a refresh token. */
export async function refreshToken(args: { refreshToken: string }): Promise<LinkedinTokenResponse> {
  const clientId = requireEnv('LINKEDIN_ADS_CLIENT_ID')
  const clientSecret = requireEnv('LINKEDIN_ADS_CLIENT_SECRET')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(LINKEDIN_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn refresh failed: HTTP ${res.status} — ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    refresh_token_expires_in?: number
    scope?: string
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSeconds: data.expires_in,
    refreshTokenExpiresInSeconds: data.refresh_token_expires_in,
    scope: data.scope,
  }
}
