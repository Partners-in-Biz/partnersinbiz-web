import { buildAuthorizeUrl, exchangeCode, refreshToken } from '@/lib/ads/providers/tiktok/oauth'

global.fetch = jest.fn() as any

describe('TikTok ads OAuth helper', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset()
    process.env.TIKTOK_ADS_CLIENT_ID = 'test-app-id'
    process.env.TIKTOK_ADS_CLIENT_SECRET = 'test-secret'
  })

  afterEach(() => {
    delete process.env.TIKTOK_ADS_CLIENT_ID
    delete process.env.TIKTOK_ADS_CLIENT_SECRET
  })

  describe('buildAuthorizeUrl', () => {
    it('includes app_id, redirect_uri, state, rid, and scope=1,4,7,8,100', () => {
      const url = buildAuthorizeUrl({
        redirectUri: 'https://partnersinbiz.online/api/v1/ads/tiktok/oauth/callback',
        state: 'test-state-xyz',
        rid: 'random-rid-123',
      })
      expect(url).toMatch(/^https:\/\/business-api\.tiktok\.com\/portal\/auth/)
      expect(url).toMatch(/app_id=test-app-id/)
      expect(url).toMatch(/redirect_uri=/)
      expect(url).toMatch(/state=test-state-xyz/)
      expect(url).toMatch(/rid=random-rid-123/)
      // scope is comma-joined numeric codes
      expect(url).toMatch(/scope=1%2C4%2C7%2C8%2C100|scope=1,4,7,8,100/)
    })

    it('throws on missing TIKTOK_ADS_CLIENT_ID', () => {
      delete process.env.TIKTOK_ADS_CLIENT_ID
      expect(() => buildAuthorizeUrl({ redirectUri: 'http://x', state: 's', rid: 'r' })).toThrow(/Missing env var: TIKTOK_ADS_CLIENT_ID/)
    })
  })

  describe('exchangeCode', () => {
    it('POSTs form-encoded body to token URL with app_id, secret, auth_code', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: 'OK',
          data: {
            access_token: 'tk',
            refresh_token: 'rt',
            expires_in: 3600,
            refresh_token_expires_in: 86400,
            advertiser_ids: ['111'],
            scope: ['1', '4'],
            token_type: 'Bearer',
          },
        }),
      })

      const result = await exchangeCode({ authCode: 'auth-code-abc' })

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/')
      expect(init.method).toBe('POST')
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(init.body).toMatch(/app_id=test-app-id/)
      expect(init.body).toMatch(/secret=test-secret/)
      expect(init.body).toMatch(/auth_code=auth-code-abc/)
    })

    it('parses success response correctly', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: 'OK',
          data: {
            access_token: 'tk',
            refresh_token: 'rt',
            expires_in: 3600,
            refresh_token_expires_in: 86400,
            advertiser_ids: ['111'],
            scope: ['1', '4'],
          },
        }),
      })

      const result = await exchangeCode({ authCode: 'auth-code-abc' })

      expect(result.accessToken).toBe('tk')
      expect(result.refreshToken).toBe('rt')
      expect(result.expiresInSeconds).toBe(3600)
      expect(result.refreshTokenExpiresInSeconds).toBe(86400)
      expect(result.advertiserIds).toEqual(['111'])
      expect(result.scope).toEqual(['1', '4'])
    })

    it('throws on envelope code !== 0 (e.g. 40001)', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 40001,
          message: 'Invalid auth_code',
          data: {},
        }),
      })

      await expect(exchangeCode({ authCode: 'bad-code' })).rejects.toThrow(/code=40001.*message=Invalid auth_code/)
    })

    it('throws on HTTP non-ok', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(exchangeCode({ authCode: 'x' })).rejects.toThrow(/TikTok token exchange HTTP 500/)
    })
  })

  describe('refreshToken', () => {
    it('POSTs with grant_type=refresh_token and refresh_token field', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: 'OK',
          data: {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 7200,
            advertiser_ids: [],
          },
        }),
      })

      const result = await refreshToken({ refreshToken: 'old-refresh-token' })

      expect(result.accessToken).toBe('new-access')
      expect(result.expiresInSeconds).toBe(7200)

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/')
      expect(init.body).toMatch(/grant_type=refresh_token/)
      expect(init.body).toMatch(/refresh_token=old-refresh-token/)
      expect(init.body).toMatch(/app_id=test-app-id/)
      expect(init.body).toMatch(/secret=test-secret/)
    })

    it('throws on envelope code !== 0', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 40002,
          message: 'Refresh token expired',
          data: {},
        }),
      })

      await expect(refreshToken({ refreshToken: 'expired' })).rejects.toThrow(/TikTok refresh failed.*code=40002/)
    })
  })
})
