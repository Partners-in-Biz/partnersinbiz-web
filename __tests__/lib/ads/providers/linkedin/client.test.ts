import { createLinkedinAdsClient, LinkedinAdsApiError } from '@/lib/ads/providers/linkedin/client'

global.fetch = jest.fn() as any

describe('LinkedIn ads REST client wrapper', () => {
  beforeEach(() => { (global.fetch as jest.Mock).mockReset() })

  const baseInput = { accessToken: 'test-access' }

  it('GET issues request with Authorization Bearer header', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: 'ok' }),
    })

    const client = createLinkedinAdsClient(baseInput)
    const result = await client.get('/adAccounts')

    expect(result).toEqual({ data: 'ok' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://api.linkedin.com/rest/adAccounts')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer test-access')
  })

  it('includes LinkedIn-Version + X-Restli-Protocol-Version headers', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{}',
    })

    const client = createLinkedinAdsClient(baseInput)
    await client.get('/adAccounts')

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.headers['LinkedIn-Version']).toBe('202405')
    expect(init.headers['X-Restli-Protocol-Version']).toBe('2.0.0')
  })

  it('POST sends JSON body + Content-Type', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => '{"created":true}',
    })

    const client = createLinkedinAdsClient(baseInput)
    await client.post('/campaigns', { name: 'Test' })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"name":"Test"}')
  })

  it('PATCH sends JSON body', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{}',
    })

    const client = createLinkedinAdsClient(baseInput)
    await client.patch('/campaigns/123', { status: 'PAUSED' })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe('{"status":"PAUSED"}')
  })

  it('DELETE issues DELETE method', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: async () => '',
    })

    const client = createLinkedinAdsClient(baseInput)
    const result = await client.delete('/campaigns/123')

    expect(result).toBeUndefined()
    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.method).toBe('DELETE')
  })

  it('custom version override is honored', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{}',
    })

    const client = createLinkedinAdsClient({ ...baseInput, version: '202401' })
    await client.get('/adAccounts')

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.headers['LinkedIn-Version']).toBe('202401')
  })

  it('non-2xx throws LinkedinAdsApiError with status + body', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    })

    const client = createLinkedinAdsClient(baseInput)
    await expect(client.get('/x')).rejects.toThrow(LinkedinAdsApiError)
    await expect(client.get('/x')).rejects.toMatchObject({ status: 403, body: 'forbidden' })
  })

  it('handles leading-slash and no-leading-slash paths uniformly', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    })

    const client = createLinkedinAdsClient(baseInput)
    await client.get('/adAccounts')
    await client.get('adAccounts')

    const calls = (global.fetch as jest.Mock).mock.calls
    expect(calls[0][0]).toBe('https://api.linkedin.com/rest/adAccounts')
    expect(calls[1][0]).toBe('https://api.linkedin.com/rest/adAccounts')
  })
})
