import { buildOAuthRedirectPath, sanitizeOAuthRedirectPath } from '@/lib/social/oauth-redirect'

describe('social OAuth redirect safety', () => {
  it('keeps YouTube Studio org-scoped callback redirects on an internal portal path', () => {
    const redirect = sanitizeOAuthRedirectPath('/portal/youtube-studio?orgId=lumen-org')

    expect(redirect).toBe('/portal/youtube-studio?orgId=lumen-org')
    expect(buildOAuthRedirectPath(redirect, { status: 'success', platform: 'youtube', account: 'acct-1' }))
      .toBe('/portal/youtube-studio?orgId=lumen-org&status=success&platform=youtube&account=acct-1')
  })

  it('falls back to the social portal for absolute or protocol-relative redirects', () => {
    expect(sanitizeOAuthRedirectPath('https://evil.example/callback')).toBe('/portal/social')
    expect(sanitizeOAuthRedirectPath('//evil.example/callback')).toBe('/portal/social')
    expect(sanitizeOAuthRedirectPath('javascript:alert(1)')).toBe('/portal/social')
  })
})
