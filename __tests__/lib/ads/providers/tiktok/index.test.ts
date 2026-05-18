// __tests__/lib/ads/providers/tiktok/index.test.ts
import { tiktokProvider } from '@/lib/ads/providers/tiktok'

global.fetch = jest.fn() as jest.Mock

describe('tiktokProvider', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
    process.env.TIKTOK_ADS_CLIENT_ID = 'test-app-id'
    process.env.TIKTOK_ADS_CLIENT_SECRET = 'test-secret'
  })

  afterEach(() => {
    delete process.env.TIKTOK_ADS_CLIENT_ID
    delete process.env.TIKTOK_ADS_CLIENT_SECRET
  })

  // Test 1: platform identifier
  it('has correct platform identifier', () => {
    expect(tiktokProvider.platform).toBe('tiktok')
  })

  // Test 2: getAuthorizeUrl includes app_id, state, rid, and scope
  it('getAuthorizeUrl returns URL with app_id, state, rid, and scope csv', () => {
    const url = tiktokProvider.getAuthorizeUrl({
      redirectUri: 'http://localhost/cb',
      state: 'my-state',
      orgId: 'org-123',
    })
    expect(url).toMatch(/app_id=test-app-id/)
    expect(url).toMatch(/state=my-state/)
    // rid is a UUID — just verify the param is present
    expect(url).toMatch(/rid=/)
    // scope csv should contain the numeric codes
    expect(url).toMatch(/scope=/)
    expect(url).toMatch(/1/)
  })

  // Test 3: exchangeCodeForToken calls exchangeCode with authCode
  it('exchangeCodeForToken calls underlying exchangeCode with auth_code shape', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: {
          access_token: 'tiktok-access',
          expires_in: 86400,
          advertiser_ids: ['123456789012345678'],
        },
      }),
      text: async () => '',
    })

    const result = await tiktokProvider.exchangeCodeForToken({
      code: 'auth-code-from-tiktok',
      redirectUri: 'http://localhost/cb',
    })

    expect(result.accessToken).toBe('tiktok-access')
    expect(result.expiresInSeconds).toBe(86400)

    // Verify the underlying fetch used `auth_code` in the request body
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
    const bodyStr = fetchCall[1].body as string
    expect(bodyStr).toMatch(/auth_code=auth-code-from-tiktok/)
  })

  // Test 4: toLongLivedToken returns 24h expiry pass-through
  it('toLongLivedToken returns accessToken unchanged with 24h expiry', async () => {
    const result = await tiktokProvider.toLongLivedToken({ accessToken: 'raw-token' })
    expect(result.accessToken).toBe('raw-token')
    expect(result.expiresInSeconds).toBe(24 * 60 * 60)
  })

  // Test 5: listAdAccounts maps TiktokAdvertiser → canonical AdAccount
  it('listAdAccounts maps TiktokAdvertiser to AdAccount with id = advertiserId', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: {
          list: [
            { advertiser_id: '123456789012345678', advertiser_name: 'Acme Corp' },
            { advertiser_id: '987654321098765432' },
          ],
        },
      }),
      text: async () => '',
    })

    const accounts = await tiktokProvider.listAdAccounts({ accessToken: 'tok' })

    expect(accounts).toHaveLength(2)
    expect(accounts[0].id).toBe('123456789012345678')
    expect(accounts[0].name).toBe('Acme Corp')
    expect(accounts[0].currency).toBe('USD') // default fallback
    // When advertiserName is absent, falls back to advertiserId as name
    expect(accounts[1].id).toBe('987654321098765432')
    expect(accounts[1].name).toBe('987654321098765432')
  })
})
