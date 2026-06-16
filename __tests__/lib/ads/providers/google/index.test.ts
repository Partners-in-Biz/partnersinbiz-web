// __tests__/lib/ads/providers/google/index.test.ts
import { googleProvider } from '@/lib/ads/providers/google'

describe('googleProvider (Phase 1)', () => {
  const prevDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN

  beforeAll(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
  })

  afterEach(() => {
    if (prevDevToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = prevDevToken
  })

  it('is a concrete (non-stub) google provider', () => {
    expect(googleProvider.platform).toBe('google')
    expect(typeof googleProvider.getAuthorizeUrl).toBe('function')
    expect(typeof googleProvider.exchangeCodeForToken).toBe('function')
    expect(typeof googleProvider.refreshToken).toBe('function')
    expect(typeof googleProvider.listAdAccounts).toBe('function')
  })

  it('builds a real authorize URL (no longer throws NotImplementedError)', () => {
    const url = googleProvider.getAuthorizeUrl({
      redirectUri: 'https://partnersinbiz.online/api/v1/ads/connections/google/callback',
      state: 'st_123',
      orgId: 'org_abc',
    })
    expect(url).toMatch(/accounts\.google\.com\/o\/oauth2\/v2\/auth/)
    expect(url).toMatch(/state=st_123/)
    expect(url).toMatch(/access_type=offline/)
  })

  it('listAdAccounts returns [] when the developer token is absent (resilient)', async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    const accounts = await googleProvider.listAdAccounts({ accessToken: 'tok' })
    expect(accounts).toEqual([])
  })
})
