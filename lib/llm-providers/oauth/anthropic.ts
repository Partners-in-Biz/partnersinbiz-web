/**
 * Anthropic Claude OAuth — PKCE authorization-code flow.
 *
 * Matches Claude Code's public OAuth client so users can connect Claude Max
 * subscriptions from Settings without an API key:
 *   - authorize: https://claude.ai/oauth/authorize
 *   - token:     https://console.anthropic.com/v1/oauth/token
 *   - callback:  https://console.anthropic.com/oauth/code/callback
 *
 * The hosted callback returns a one-time code the user pastes back into
 * Settings; there is no device-code polling for Anthropic.
 */
import crypto from 'node:crypto'

const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const ANTHROPIC_OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const ANTHROPIC_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const ANTHROPIC_OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const ANTHROPIC_OAUTH_SCOPE = 'org:create_api_key user:profile user:inference'

export interface AnthropicPkceStart {
  authorizeUrl: string
  /** Raw PKCE verifier — server-side only, encrypted at rest in the session. */
  verifier: string
  /** OAuth state. Claude Code derives state from the verifier; we mirror that. */
  state: string
}

export interface AnthropicTokenPayload {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}

/** Terminal refresh/exchange failures require the user to reconnect the account. */
export class AnthropicOAuthRefreshError extends Error {
  constructor(
    message: string,
    readonly terminal: boolean,
    /** Upstream HTTP status when Anthropic supplied one. */
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AnthropicOAuthRefreshError'
  }
}

type AnthropicErrorPayload = {
  error?: unknown
  error_description?: unknown
  message?: unknown
}

function upstreamErrorMessage(payload: AnthropicErrorPayload, status: number, operation: 'exchange' | 'refresh'): string {
  if (typeof payload.error_description === 'string' && payload.error_description.trim()) {
    return payload.error_description.trim()
  }
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim()
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  // Anthropic/Cloudflare rate-limit responses use { error: { type, message } }.
  // Never pass that object directly to Error(), which renders as "[object Object]".
  if (payload.error && typeof payload.error === 'object') {
    const nested = payload.error as { message?: unknown; type?: unknown }
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim()
    if (typeof nested.type === 'string' && nested.type.trim()) return nested.type.trim()
  }
  return `Anthropic OAuth ${operation} failed (${status})`
}

function base64UrlNoPadding(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/** 32 random bytes, base64url, no padding (43 chars). */
export function generatePkceVerifier(): string {
  return base64UrlNoPadding(crypto.randomBytes(32))
}

/** S256 PKCE code challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return base64UrlNoPadding(crypto.createHash('sha256').update(verifier).digest())
}

export function startAnthropicPkce(): AnthropicPkceStart {
  const verifier = generatePkceVerifier()
  const state = verifier
  const params = new URLSearchParams({
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
    scope: ANTHROPIC_OAUTH_SCOPE,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  })
  return {
    authorizeUrl: `${ANTHROPIC_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
    verifier,
    state,
  }
}

function terminalFor(errorCode: string | undefined, status: number): boolean {
  return status === 401
    || ['invalid_grant', 'invalid_token', 'invalid_request', 'unauthorized_client'].includes(errorCode || '')
}

export async function exchangeAnthropicCode(input: {
  code: string
  verifier: string
  state?: string
}): Promise<AnthropicTokenPayload> {
  // Claude Code sets state = verifier; validate when the caller forwards state.
  if (input.state && input.state !== input.verifier) {
    throw new AnthropicOAuthRefreshError('OAuth state mismatch', false)
  }
  const response = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'anthropic',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.verifier,
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
    }),
  })
  const payload = await response.json().catch(() => ({})) as AnthropicTokenPayload & AnthropicErrorPayload
  if (!response.ok || !payload.access_token) {
    throw new AnthropicOAuthRefreshError(
      upstreamErrorMessage(payload, response.status, 'exchange'),
      terminalFor(typeof payload.error === 'string' ? payload.error : undefined, response.status),
      response.status,
    )
  }
  return payload
}

export async function refreshAnthropicToken(refreshToken: string): Promise<AnthropicTokenPayload> {
  const response = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'anthropic',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    }),
  })
  const payload = await response.json().catch(() => ({})) as AnthropicTokenPayload & AnthropicErrorPayload
  if (!response.ok || !payload.access_token) {
    throw new AnthropicOAuthRefreshError(
      upstreamErrorMessage(payload, response.status, 'refresh'),
      terminalFor(typeof payload.error === 'string' ? payload.error : undefined, response.status),
      response.status,
    )
  }
  return payload
}
