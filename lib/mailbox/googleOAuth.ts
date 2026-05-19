export const MAILBOX_GOOGLE_STATE_COLLECTION = 'mailbox_oauth_states'
export const MAILBOX_GOOGLE_STATE_TTL_MINUTES = 10

export const MAILBOX_GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const

export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

export type GoogleTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export type GoogleUserInfo = {
  email?: string
  name?: string
}

export function readMailboxGoogleOAuthEnv() {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '').trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function appBaseUrl(reqUrl?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return reqUrl ? new URL(reqUrl).origin : 'http://localhost:3000'
}

export function buildMailboxGoogleAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  emailAddress?: string
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: MAILBOX_GOOGLE_SCOPES.join(' '),
    state: input.state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  })
  if (input.emailAddress) params.set('login_hint', input.emailAddress)
  return `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`
}

export async function exchangeMailboxGoogleCode(input: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}) {
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

export async function fetchMailboxGoogleUserInfo(accessToken: string) {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return (await res.json()) as GoogleUserInfo
}
