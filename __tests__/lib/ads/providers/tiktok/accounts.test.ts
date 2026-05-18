import { listAdvertisers } from '@/lib/ads/providers/tiktok/accounts'

describe('TikTok listAdvertisers', () => {
  beforeEach(() => {
    process.env.TIKTOK_ADS_CLIENT_ID = 'test-app-id'
    process.env.TIKTOK_ADS_CLIENT_SECRET = 'test-secret'
  })

  afterEach(() => {
    delete process.env.TIKTOK_ADS_CLIENT_ID
    delete process.env.TIKTOK_ADS_CLIENT_SECRET
  })

  it('GETs /oauth2/advertiser/get/ with app_id, secret, access_token in query and returns mapped list', async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: {
          list: [
            { advertiser_id: '111111', advertiser_name: 'Acme Corp' },
            { advertiser_id: '222222', advertiser_name: 'Beta Brand' },
          ],
        },
      }),
    })

    const result = await listAdvertisers({ accessToken: 'tok-abc', fetchImpl: mockFetch as any })

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/\/oauth2\/advertiser\/get\//)
    expect(url).toMatch(/app_id=test-app-id/)
    expect(url).toMatch(/secret=test-secret/)
    expect(url).toMatch(/access_token=tok-abc/)
    expect(init.method).toBe('GET')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ advertiserId: '111111', advertiserName: 'Acme Corp' })
    expect(result[1]).toEqual({ advertiserId: '222222', advertiserName: 'Beta Brand' })
  })

  it('throws when TIKTOK_ADS_CLIENT_ID or TIKTOK_ADS_CLIENT_SECRET is missing', async () => {
    delete process.env.TIKTOK_ADS_CLIENT_ID

    await expect(listAdvertisers({ accessToken: 'tok' })).rejects.toThrow(
      'TIKTOK_ADS_CLIENT_ID + TIKTOK_ADS_CLIENT_SECRET required'
    )

    // restore and delete secret
    process.env.TIKTOK_ADS_CLIENT_ID = 'test-app-id'
    delete process.env.TIKTOK_ADS_CLIENT_SECRET

    await expect(listAdvertisers({ accessToken: 'tok' })).rejects.toThrow(
      'TIKTOK_ADS_CLIENT_ID + TIKTOK_ADS_CLIENT_SECRET required'
    )
  })

  it('throws when envelope code !== 0', async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 40001,
        message: 'Invalid access token',
        data: {},
      }),
    })

    await expect(listAdvertisers({ accessToken: 'bad-tok', fetchImpl: mockFetch as any })).rejects.toThrow(
      /TikTok listAdvertisers code=40001 message=Invalid access token/
    )
  })
})
