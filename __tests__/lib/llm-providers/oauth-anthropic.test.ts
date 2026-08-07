import crypto from 'node:crypto'
import {
  AnthropicOAuthRefreshError,
  exchangeAnthropicCode,
  generatePkceVerifier,
  pkceChallenge,
  refreshAnthropicToken,
  startAnthropicPkce,
} from '@/lib/llm-providers/oauth/anthropic'

const fetchMock = jest.fn()

function base64UrlNoPadding(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('Anthropic PKCE authorization-code flow', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('generates a 32-byte base64url-no-padding verifier (43 chars) with S256 challenge', () => {
    const verifier = generatePkceVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifier).not.toContain('=')
    const decoded = Buffer.from(verifier, 'base64url')
    expect(decoded.length).toBe(32)

    const challenge = pkceChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).not.toContain('=')
    // S256 = base64url(sha256(verifier))
    expect(challenge).toBe(base64UrlNoPadding(crypto.createHash('sha256').update(verifier).digest()))
  })

  it('builds a Claude Code compatible authorize URL with state == verifier', () => {
    const started = startAnthropicPkce()
    expect(started.state).toBe(started.verifier)
    const url = new URL(started.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('https://console.anthropic.com/oauth/code/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(started.verifier))
    expect(url.searchParams.get('state')).toBe(started.verifier)
    expect(url.searchParams.get('scope')).toBe('org:create_api_key user:profile user:inference')
  })

  it('exchanges the pasted code with JSON body, application/json + anthropic user agent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 21600,
      token_type: 'Bearer',
      scope: 'org:create_api_key user:profile user:inference',
    }))

    const verifier = generatePkceVerifier()
    const tokens = await exchangeAnthropicCode({ code: 'callback-code', verifier, state: verifier })

    expect(tokens.access_token).toBe('at-1')
    expect(tokens.refresh_token).toBe('rt-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://console.anthropic.com/v1/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'User-Agent': 'anthropic' }),
      }),
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://console.anthropic.com/v1/oauth/token')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      grant_type: 'authorization_code',
      code: 'callback-code',
      code_verifier: verifier,
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    })
  })

  it('rejects a mismatched state before hitting the token endpoint', async () => {
    const verifier = generatePkceVerifier()
    await expect(exchangeAnthropicCode({ code: 'x', verifier, state: 'different' }))
      .rejects.toThrow('OAuth state mismatch')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces exchange failures with terminal flag for invalid grants', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant', error_description: 'Code expired' }))
    const verifier = generatePkceVerifier()
    await expect(exchangeAnthropicCode({ code: 'stale', verifier }))
      .rejects.toMatchObject({ name: 'AnthropicOAuthRefreshError', terminal: true, message: 'Code expired' })
  })

  it('normalizes Anthropic structured rate-limit errors instead of rendering [object Object]', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {
      error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' },
    }))
    const verifier = generatePkceVerifier()
    await expect(exchangeAnthropicCode({ code: 'callback-code', verifier }))
      .rejects.toMatchObject({
        name: 'AnthropicOAuthRefreshError',
        message: 'Rate limited. Please try again later.',
        terminal: false,
        status: 429,
      })
  })

  it('refreshes with grant_type=refresh_token and the public client id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'at-2',
      refresh_token: 'rt-2',
      expires_in: 21600,
    }))

    const tokens = await refreshAnthropicToken('rt-1')

    expect(tokens.access_token).toBe('at-2')
    expect(tokens.refresh_token).toBe('rt-2')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://console.anthropic.com/v1/oauth/token')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt-1',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    })
    expect((init as RequestInit).headers).toMatchObject({ 'User-Agent': 'anthropic' })
  })

  it('flags terminal refresh errors so the worker can mark reauth_required', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'invalid_token', error_description: 'Refresh token revoked' }))
    await expect(refreshAnthropicToken('rt-dead')).rejects.toMatchObject({
      terminal: true,
      message: 'Refresh token revoked',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps retryable refresh errors non-terminal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'temporarily_unavailable' }))
    const error = await refreshAnthropicToken('rt-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AnthropicOAuthRefreshError)
    expect((error as AnthropicOAuthRefreshError).terminal).toBe(false)
  })
})
