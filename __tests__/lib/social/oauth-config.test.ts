import { getOAuthConfig } from '@/lib/social/oauth-config'

describe('getOAuthConfig', () => {
  it('uses LinkedIn company-page scopes for the social posting app', () => {
    const config = getOAuthConfig('linkedin')

    expect(config?.scopes).toEqual(['w_organization_social'])
    expect(config?.scopes).not.toContain('w_member_social')
    expect(config?.scopes).not.toContain('openid')
    expect(config?.scopes).not.toContain('profile')
  })
})
