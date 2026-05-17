import { listAdAccounts } from '@/lib/ads/providers/linkedin/accounts'

global.fetch = jest.fn() as any

describe('LinkedIn list ad accounts', () => {
  beforeEach(() => { (global.fetch as jest.Mock).mockReset() })

  it('returns mapped accounts from data.elements', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        elements: [
          { id: 12345, name: 'Test Account', currency: 'ZAR', type: 'BUSINESS', status: 'ACTIVE', reference: 'urn:li:organization:99' },
          { id: 67890, name: 'Second Account', currency: 'USD', type: 'BUSINESS', status: 'DRAFT' },
        ],
      }),
    })

    const result = await listAdAccounts({ accessToken: 'tok' })

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: '12345',
      urn: 'urn:li:sponsoredAccount:12345',
      name: 'Test Account',
      currency: 'ZAR',
      type: 'BUSINESS',
      status: 'ACTIVE',
      reference: 'urn:li:organization:99',
    })
  })

  it('builds URN as urn:li:sponsoredAccount:{id}', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ elements: [{ id: 999 }] }),
    })

    const result = await listAdAccounts({ accessToken: 'tok' })
    expect(result[0].urn).toBe('urn:li:sponsoredAccount:999')
  })

  it('filters out elements with empty id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        elements: [
          { id: 100, name: 'Valid' },
          { name: 'No ID' },  // id missing
          { id: '', name: 'Empty string ID' },
        ],
      }),
    })

    const result = await listAdAccounts({ accessToken: 'tok' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('100')
  })

  it('returns empty array when no elements', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ paging: {} }),  // no elements key
    })

    const result = await listAdAccounts({ accessToken: 'tok' })
    expect(result).toEqual([])
  })

  it('headers include Authorization + LinkedIn-Version + X-Restli-Protocol-Version', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ elements: [] }),
    })

    await listAdAccounts({ accessToken: 'my-token' })

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer my-token')
    expect(headers['LinkedIn-Version']).toBe('202405')
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0')
  })

  it('URL includes encoded search filter for ACTIVE+DRAFT status', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ elements: [] }),
    })

    await listAdAccounts({ accessToken: 'tok' })

    const [url] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/adAccounts\?q=search&search=/)
    // Decoded back, should include status:ACTIVE + DRAFT
    expect(decodeURIComponent(url)).toMatch(/status:\(values:List\(ACTIVE,DRAFT\)\)/)
  })

  it('throws on non-2xx with body in error message', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'INVALID_TOKEN',
    })

    await expect(listAdAccounts({ accessToken: 'bad' })).rejects.toThrow(/LinkedIn ad accounts listing failed.*HTTP 401.*INVALID_TOKEN/)
  })
})
