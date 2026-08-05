/**
 * Nous Portal device-code OAuth.
 * Endpoints and client credentials match Hermes Agent hermes_cli/auth.py
 * (DEFAULT_NOUS_PORTAL_URL / DEFAULT_NOUS_CLIENT_ID / NOUS_INFERENCE_INVOKE_SCOPE).
 */
const NOUS_PORTAL_BASE_URL = 'https://portal.nousresearch.com'
const NOUS_OAUTH_CLIENT_ID = 'hermes-cli'
const NOUS_OAUTH_SCOPE = 'inference:invoke'
const NOUS_OAUTH_DEVICE_CODE_URL = `${NOUS_PORTAL_BASE_URL}/api/oauth/device/code`
const NOUS_OAUTH_TOKEN_URL = `${NOUS_PORTAL_BASE_URL}/api/oauth/token`

export interface NousDeviceCodeStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  tokenEndpoint: string
  expiresIn: number
  intervalSeconds: number
}

export interface NousTokenPayload {
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
  scope?: string
}

export async function startNousDeviceCode(): Promise<NousDeviceCodeStart> {
  const response = await fetch(NOUS_OAUTH_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: NOUS_OAUTH_CLIENT_ID,
      scope: NOUS_OAUTH_SCOPE,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Nous Portal device-code request failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  const payload = await response.json() as Record<string, unknown>
  const deviceCode = String(payload.device_code || '')
  const userCode = String(payload.user_code || '')
  const verificationUri = String(payload.verification_uri || '')
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error('Nous Portal device-code response missing required fields')
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: payload.verification_uri_complete
      ? String(payload.verification_uri_complete)
      : null,
    tokenEndpoint: NOUS_OAUTH_TOKEN_URL,
    expiresIn: Number(payload.expires_in) || 900,
    intervalSeconds: Math.max(1, Number(payload.interval) || 5),
  }
}

export type NousPollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'completed'; tokens: NousTokenPayload }
  | { status: 'failed'; error: string }

export async function pollNousDeviceToken(input: {
  tokenEndpoint: string
  deviceCode: string
}): Promise<NousPollResult> {
  const response = await fetch(input.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: NOUS_OAUTH_CLIENT_ID,
      device_code: input.deviceCode,
    }),
  })

  if (response.status === 200) {
    const payload = await response.json() as NousTokenPayload
    if (!payload.access_token || !payload.refresh_token) {
      return { status: 'failed', error: 'Nous Portal token response missing access or refresh token' }
    }
    return { status: 'completed', tokens: payload }
  }

  const errorPayload = await response.json().catch(() => ({})) as {
    error?: string
    error_description?: string
  }
  const code = String(errorPayload.error || '')
  if (code === 'authorization_pending') return { status: 'pending' }
  if (code === 'slow_down') return { status: 'slow_down' }
  return {
    status: 'failed',
    error: errorPayload.error_description || errorPayload.error || `HTTP ${response.status}`,
  }
}
