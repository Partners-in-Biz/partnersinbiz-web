import { createTiktokAdsClient, TiktokAdsApiError } from '@/lib/ads/providers/tiktok/client'

describe('TikTok ads API client', () => {
  const makeClient = (fetchImpl: jest.Mock) =>
    createTiktokAdsClient({ accessToken: 'test-token', fetchImpl: fetchImpl as any })

  let mockFetch: jest.Mock

  beforeEach(() => {
    mockFetch = jest.fn()
  })

  it('sets Access-Token header (NOT Authorization: Bearer)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK', data: { result: 'ok' } }),
    })

    const client = makeClient(mockFetch)
    await client.get('/campaigns')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Access-Token']).toBe('test-token')
    expect(init.headers['Authorization']).toBeUndefined()
  })

  it('throws TiktokAdsApiError on envelope code !== 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 40001, message: 'Permission denied', data: {} }),
    })

    const client = makeClient(mockFetch)
    await expect(client.get('/campaigns')).rejects.toThrow(TiktokAdsApiError)
    await expect(
      makeClient(jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 40001, message: 'Permission denied', data: {} }),
      })).get('/campaigns')
    ).rejects.toMatchObject({ code: 40001 })
  })

  it('throws TiktokAdsApiError on HTTP non-ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    })

    const client = makeClient(mockFetch)
    await expect(client.get('/campaigns')).rejects.toThrow(TiktokAdsApiError)
  })

  it('GET passes query params correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK', data: [] }),
    })

    const client = makeClient(mockFetch)
    await client.get('/campaigns', { advertiser_id: '999', page_size: 50 })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toMatch(/advertiser_id=999/)
    expect(url).toMatch(/page_size=50/)
  })

  it('POST sends JSON body with correct method', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK', data: { campaign_id: '12345' } }),
    })

    const client = makeClient(mockFetch)
    const result = await client.post('/campaign/create/', { advertiser_id: '999', campaign_name: 'Test' })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"advertiser_id":"999","campaign_name":"Test"}')
    expect(result).toEqual({ campaign_id: '12345' })
  })
})
