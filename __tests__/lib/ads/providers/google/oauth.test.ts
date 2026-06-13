// __tests__/lib/ads/providers/google/oauth.test.ts
import {
  GOOGLE_ADS_SCOPES_FOR_ADS_MODULE,
  buildAdsAuthorizeUrl,
} from '@/lib/ads/providers/google/oauth'

describe('Google Ads OAuth (ads module wrapper)', () => {
  beforeAll(() => {
    // Same env var the analytics adapter reads — see
    // `lib/integrations/google_ads/oauth.ts` `readOAuthEnv()`.
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
  })

  it('exports the adwords scope', () => {
    expect(GOOGLE_ADS_SCOPES_FOR_ADS_MODULE).toContain(
      'https://www.googleapis.com/auth/adwords',
    )
  })

  it('builds an authorize URL with state + redirect', () => {
    const url = buildAdsAuthorizeUrl({
      redirectUri:
        'https://partnersinbiz.online/api/v1/ads/google/oauth/callback',
      state: 'test-state',
      orgId: 'org-abc',
    })
    expect(url).toMatch(/accounts\.google\.com\/o\/oauth2\/v2\/auth/)
    expect(url).toMatch(/state=test-state/)
    expect(url).toMatch(/access_type=offline/)
    expect(url).toMatch(/prompt=consent/)
  })
})
