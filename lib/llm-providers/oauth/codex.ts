/**
 * OpenAI Codex (ChatGPT) device-code OAuth.
 * Endpoints match Hermes Agent hermes_cli/auth.py.
 */
const CODEX_ISSUER = 'https://auth.openai.com'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'

export interface CodexDeviceCodeStart {
  deviceAuthId: string
  userCode: string
  verificationUri: string
  expiresIn: number
  intervalSeconds: number
}

export interface CodexTokenPayload {
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
  id_token?: string
}

export async function startCodexDeviceCode(): Promise<CodexDeviceCodeStart> {
  const response = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
  })
  if (response.status === 429) {
    throw new Error('OpenAI is rate-limiting Codex login requests. Wait a minute and try again.')
  }
  if (!response.ok) {
    throw new Error(`Codex device-code request failed (${response.status})`)
  }
  const payload = await response.json() as {
    user_code?: string
    device_auth_id?: string
    interval?: string | number
  }
  const userCode = String(payload.user_code || '')
  const deviceAuthId = String(payload.device_auth_id || '')
  if (!userCode || !deviceAuthId) {
    throw new Error('Codex device-code response missing required fields')
  }
  return {
    deviceAuthId,
    userCode,
    verificationUri: `${CODEX_ISSUER}/codex/device`,
    expiresIn: 15 * 60,
    intervalSeconds: Math.max(3, Number(payload.interval) || 5),
  }
}

export type CodexPollResult =
  | { status: 'pending' }
  | { status: 'completed'; tokens: CodexTokenPayload }
  | { status: 'failed'; error: string }

export async function pollCodexDeviceToken(input: {
  deviceAuthId: string
  userCode: string
}): Promise<CodexPollResult> {
  const pollRes = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      device_auth_id: input.deviceAuthId,
      user_code: input.userCode,
    }),
  })

  if (pollRes.status === 403 || pollRes.status === 404) {
    return { status: 'pending' }
  }
  if (!pollRes.ok) {
    return { status: 'failed', error: `Codex device auth polling failed (${pollRes.status})` }
  }

  const codeResp = await pollRes.json() as {
    authorization_code?: string
    code_verifier?: string
  }
  const authorizationCode = String(codeResp.authorization_code || '')
  const codeVerifier = String(codeResp.code_verifier || '')
  if (!authorizationCode || !codeVerifier) {
    return { status: 'failed', error: 'Codex auth response missing authorization_code or code_verifier' }
  }

  const tokenRes = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  })

  if (tokenRes.status === 429) {
    return { status: 'failed', error: 'OpenAI rate-limited the Codex token exchange. Try again shortly.' }
  }
  if (!tokenRes.ok) {
    return { status: 'failed', error: `Codex token exchange failed (${tokenRes.status})` }
  }

  const tokens = await tokenRes.json() as CodexTokenPayload
  if (!tokens.access_token || !tokens.refresh_token) {
    return { status: 'failed', error: 'Codex token response missing access or refresh token' }
  }
  return { status: 'completed', tokens }
}
