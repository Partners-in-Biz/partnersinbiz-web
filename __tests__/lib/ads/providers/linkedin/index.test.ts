// __tests__/lib/ads/providers/linkedin/index.test.ts
import { linkedinProvider } from '@/lib/ads/providers/linkedin'

global.fetch = jest.fn() as jest.Mock

describe('linkedinProvider', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
    process.env.LINKEDIN_ADS_CLIENT_ID = 'test-client-id'
    process.env.LINKEDIN_ADS_CLIENT_SECRET = 'test-secret'
  })

  afterEach(() => {
    delete process.env.LINKEDIN_ADS_CLIENT_ID
    delete process.env.LINKEDIN_ADS_CLIENT_SECRET
  })

  // Test 1: platform identifier
  it('has correct platform identifier', () => {
    expect(linkedinProvider.platform).toBe('linkedin')
  })

  // Test 2: getAuthorizeUrl
  it('getAuthorizeUrl returns URL with LinkedIn host, client_id, redirect_uri, and state', () => {
    const url = linkedinProvider.getAuthorizeUrl({
      redirectUri: 'http://localhost/cb',
      state: 'abc',
      orgId: 'org-123',
    })
    expect(url).toMatch(/linkedin\.com\/oauth\/v2\/authorization/)
    expect(url).toMatch(/client_id=test-client-id/)
    expect(url).toMatch(/redirect_uri=http/)
    expect(url).toMatch(/state=abc/)
  })

  // Test 3: exchangeCodeForToken shape
  it('exchangeCodeForToken returns { accessToken, expiresInSeconds } from LinkedIn token response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tk', expires_in: 3600 }),
      text: async () => '',
    })

    const result = await linkedinProvider.exchangeCodeForToken({
      code: 'auth-code',
      redirectUri: 'http://localhost/cb',
    })

    expect(result.accessToken).toBe('tk')
    expect(result.expiresInSeconds).toBe(3600)
  })

  // Test 4: toLongLivedToken passes through accessToken with 60-day TTL
  it('toLongLivedToken passes through accessToken verbatim with 60-day TTL', async () => {
    const result = await linkedinProvider.toLongLivedToken({ accessToken: 'my-token' })
    expect(result.accessToken).toBe('my-token')
    expect(result.expiresInSeconds).toBe(60 * 24 * 60 * 60)
  })

  // Test 5: listAdAccounts maps URN to canonical AdAccount.id
  it('listAdAccounts maps urn:li:sponsoredAccount:{id} to canonical AdAccount.id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        elements: [{ id: 12345, name: 'Test', currency: 'USD', status: 'ACTIVE' }],
      }),
      text: async () => '',
    })

    const accounts = await linkedinProvider.listAdAccounts({ accessToken: 'tok' })

    expect(accounts).toHaveLength(1)
    expect(accounts[0].id).toBe('urn:li:sponsoredAccount:12345')
    expect(accounts[0].name).toBe('Test')
    expect(accounts[0].currency).toBe('USD')
  })

  // Bonus test 6: listAdAccounts falls back name to numeric id when name is missing
  it('listAdAccounts falls back name to numeric account id when name absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        elements: [{ id: 99999, currency: 'ZAR', status: 'DRAFT' }],
      }),
      text: async () => '',
    })

    const accounts = await linkedinProvider.listAdAccounts({ accessToken: 'tok' })

    expect(accounts[0].id).toBe('urn:li:sponsoredAccount:99999')
    expect(accounts[0].name).toBe('99999')
  })

  // Bonus test 7: refreshToken delegates to oauth refreshToken helper
  it('refreshToken returns accessToken and expiresInSeconds from LinkedIn refresh response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-access', expires_in: 5184000, refresh_token: 'new-refresh' }),
      text: async () => '',
    })

    const result = await linkedinProvider.refreshToken({ refreshToken: 'old-refresh' })

    expect(result.accessToken).toBe('new-access')
    expect(result.expiresInSeconds).toBe(5184000)
    expect(result.refreshToken).toBe('new-refresh')
  })
})
