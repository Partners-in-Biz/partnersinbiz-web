import { getOAuthConfig } from '@/lib/social/oauth-config'

describe('getOAuthConfig', () => {
  it('uses LinkedIn personal scopes by default', () => {
    const config = getOAuthConfig('linkedin')

    expect(config?.scopes).toEqual(['w_member_social', 'openid', 'profile'])
    expect(config?.scopes).not.toContain('w_organization_social')
  })

  it('uses LinkedIn company-page scopes for organization mode', () => {
    const config = getOAuthConfig('linkedin', { linkedinMode: 'organization' })

    expect(config?.scopes).toEqual(['w_organization_social'])
    expect(config?.scopes).not.toContain('w_member_social')
    expect(config?.scopes).not.toContain('openid')
    expect(config?.scopes).not.toContain('profile')
  })
})
