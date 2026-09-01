import { getClientCredentials, getOAuthConfig } from '@/lib/social/oauth-config'

describe('getOAuthConfig', () => {
  const originalCma = process.env.LINKEDIN_CMA_ENABLED

  afterEach(() => {
    if (originalCma === undefined) delete process.env.LINKEDIN_CMA_ENABLED
    else process.env.LINKEDIN_CMA_ENABLED = originalCma
  })

  it('uses LinkedIn personal scopes by default', () => {
    delete process.env.LINKEDIN_CMA_ENABLED
    const config = getOAuthConfig('linkedin')

    expect(config?.scopes).toEqual(['w_member_social', 'openid', 'profile'])
    expect(config?.scopes).not.toContain('w_organization_social')
    expect(config?.scopes).not.toContain('rw_organization_admin')
    expect(config?.scopes).not.toContain('w_organization_social_feed')
  })

  it('uses LinkedIn company-page scopes for organization mode', () => {
    delete process.env.LINKEDIN_CMA_ENABLED
    const config = getOAuthConfig('linkedin', { linkedinMode: 'organization' })

    expect(config?.scopes).toEqual(['rw_organization_admin', 'w_organization_social'])
    expect(config?.scopes).not.toContain('w_organization_social_feed')
    expect(config?.scopes).not.toContain('w_member_social')
  })

  it('uses LinkedIn company-page scopes for organization mode only when CMA is on', () => {
    process.env.LINKEDIN_CMA_ENABLED = 'true'
    const config = getOAuthConfig('linkedin', { linkedinMode: 'organization' })

    expect(config?.scopes).toEqual(['rw_organization_admin', 'w_organization_social'])
    expect(config?.scopes).not.toContain('w_organization_social_feed')
    expect(config?.scopes).not.toContain('w_member_social')
    expect(config?.scopes).not.toContain('openid')
    expect(config?.scopes).not.toContain('profile')
  })
})

describe('getClientCredentials linkedin', () => {
  const keys = [
    'LINKEDIN_CLIENT_ID',
    'LINKEDIN_CLIENT_SECRET',
    'LINKEDIN_PERSONAL_CLIENT_ID',
    'LINKEDIN_PERSONAL_CLIENT_SECRET',
    'LINKEDIN_ORGANIZATION_CLIENT_ID',
    'LINKEDIN_ORGANIZATION_CLIENT_SECRET',
  ] as const
  const snapshot = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of keys) {
      if (snapshot[key] === undefined) delete process.env[key]
      else process.env[key] = snapshot[key]
    }
  })

  it('uses the existing LinkedIn app client id/secret for personal connect', () => {
    process.env.LINKEDIN_CLIENT_ID = 'existing-app-id'
    process.env.LINKEDIN_CLIENT_SECRET = 'existing-app-secret'
    delete process.env.LINKEDIN_PERSONAL_CLIENT_ID
    delete process.env.LINKEDIN_PERSONAL_CLIENT_SECRET

    expect(getClientCredentials('linkedin', { linkedinMode: 'personal' })).toEqual({
      clientId: 'existing-app-id',
      clientSecret: 'existing-app-secret',
    })
  })
})
