import { buildAuthorizeUrl, exchangeCode, refreshToken } from '@/lib/ads/providers/linkedin/oauth'

global.fetch = jest.fn() as any

describe('LinkedIn ads OAuth helper', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset()
    process.env.LINKEDIN_ADS_CLIENT_ID = 'test-client-id'
    process.env.LINKEDIN_ADS_CLIENT_SECRET = 'test-client-secret'
  })

  describe('buildAuthorizeUrl', () => {
    it('builds correct URL with state + redirect + space-joined scopes', () => {
      const url = buildAuthorizeUrl({
        redirectUri: 'https://partnersinbiz.online/api/v1/ads/linkedin/oauth/callback',
        state: 'test-state-abc',
      })
      expect(url).toMatch(/^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization/)
      expect(url).toMatch(/response_type=code/)
      expect(url).toMatch(/client_id=test-client-id/)
      expect(url).toMatch(/state=test-state-abc/)
      // Scopes joined by space (URL-encoded as +)
      expect(url).toMatch(/scope=r_ads.*rw_ads.*r_ads_reporting.*rw_organization_admin/)
    })

    it('throws on missing LINKEDIN_ADS_CLIENT_ID', () => {
      delete process.env.LINKEDIN_ADS_CLIENT_ID
      expect(() => buildAuthorizeUrl({ redirectUri: 'http://x', state: 's' })).toThrow(/Missing env var: LINKEDIN_ADS_CLIENT_ID/)
    })
  })

  describe('exchangeCode', () => {
    it('POSTs to token URL with grant_type=authorization_code + credentials', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-xyz',
          refresh_token: 'refresh-abc',
          expires_in: 5184000,
          refresh_token_expires_in: 31536000,
          scope: 'r_ads rw_ads',
        }),
      })

      const result = await exchangeCode({
        code: 'auth-code',
        redirectUri: 'http://test/cb',
      })

      expect(result.accessToken).toBe('access-xyz')
      expect(result.refreshToken).toBe('refresh-abc')
      expect(result.expiresInSeconds).toBe(5184000)
      expect(result.refreshTokenExpiresInSeconds).toBe(31536000)
      expect(result.scope).toBe('r_ads rw_ads')

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('https://www.linkedin.com/oauth/v2/accessToken')
      expect(init.method).toBe('POST')
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(init.body).toMatch(/grant_type=authorization_code/)
      expect(init.body).toMatch(/code=auth-code/)
      expect(init.body).toMatch(/client_id=test-client-id/)
      expect(init.body).toMatch(/client_secret=test-client-secret/)
    })

    it('throws on non-2xx with body in error', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'invalid_client',
      })

      await expect(exchangeCode({ code: 'x', redirectUri: 'y' })).rejects.toThrow(/LinkedIn token exchange failed.*HTTP 401.*invalid_client/)
    })
  })

  describe('refreshToken', () => {
    it('POSTs with grant_type=refresh_token', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          expires_in: 5184000,
        }),
      })

      const result = await refreshToken({ refreshToken: 'old-refresh' })

      expect(result.accessToken).toBe('new-access')
      expect(result.expiresInSeconds).toBe(5184000)

      const [, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(init.body).toMatch(/grant_type=refresh_token/)
      expect(init.body).toMatch(/refresh_token=old-refresh/)
    })

    it('throws on non-2xx', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      })

      await expect(refreshToken({ refreshToken: 'expired' })).rejects.toThrow(/LinkedIn refresh failed/)
    })
  })

  it('exchangeCode response without refresh_token field returns undefined refreshToken', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'a', expires_in: 100 }),
    })

    const result = await exchangeCode({ code: 'c', redirectUri: 'r' })
    expect(result.refreshToken).toBeUndefined()
  })
})
