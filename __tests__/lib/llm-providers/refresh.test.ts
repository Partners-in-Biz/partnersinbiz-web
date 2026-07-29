/**
 * @jest-environment node
 */
import { oauthAccessTokenExpiresAt, xaiCredentialsNeedRefresh } from '@/lib/llm-providers/refresh'
import { refreshXaiOAuthToken, XaiOAuthRefreshError } from '@/lib/llm-providers/oauth/xai'

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

describe('central xAI OAuth refresh decisions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reads the expiry from an OAuth JWT', () => {
    expect(oauthAccessTokenExpiresAt(jwt(1_900_000_000))).toBe(1_900_000_000_000)
  })

  it('refreshes invalid and near-expiry access tokens before machine delivery', () => {
    const now = 1_900_000_000_000
    expect(xaiCredentialsNeedRefresh({ access_token: 'not-a-jwt' }, now)).toBe(true)
    expect(xaiCredentialsNeedRefresh({ access_token: jwt(1_900_000_600) }, now)).toBe(true)
    expect(xaiCredentialsNeedRefresh({ access_token: jwt(1_900_003_600) }, now)).toBe(false)
  })

  it('distinguishes a dead refresh token from a temporary provider failure', async () => {
    const responses = [
      new Response(JSON.stringify({ token_endpoint: 'https://auth.x.ai/token' }), { status: 200 }),
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token expired' }), { status: 400 }),
    ]
    jest.spyOn(global, 'fetch').mockImplementation(async () => responses.shift()!)
    await expect(refreshXaiOAuthToken('expired-refresh')).rejects.toMatchObject<XaiOAuthRefreshError>({
      terminal: true,
    })
  })
})
