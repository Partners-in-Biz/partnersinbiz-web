import { isCompanyLinkedAccount, isPersonalAccountRecord } from '@/lib/social/account-scope'

describe('isCompanyLinkedAccount', () => {
  it('hides personal-scoped rows even when they look like pages', () => {
    expect(isPersonalAccountRecord({ accountScope: 'personal' })).toBe(true)
    expect(isCompanyLinkedAccount({
      accountScope: 'personal',
      accountType: 'page',
      platform: 'facebook',
    })).toBe(false)
  })

  it('hides unscoped person-profile twins from company social', () => {
    expect(isCompanyLinkedAccount({
      displayName: 'Peet Stander',
      accountType: 'personal',
      platform: 'twitter',
    } as { accountType?: string; platform?: string })).toBe(false)
    expect(isCompanyLinkedAccount({
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(false)
  })

  it('keeps company pages and explicit org brand handles', () => {
    expect(isCompanyLinkedAccount({ accountType: 'page', platform: 'facebook' })).toBe(true)
    expect(isCompanyLinkedAccount({ accountType: 'business', platform: 'instagram' })).toBe(true)
    expect(isCompanyLinkedAccount({ accountScope: 'org', accountType: 'personal', platform: 'twitter' })).toBe(true)
    expect(isCompanyLinkedAccount({ platform: 'bluesky' })).toBe(true)
  })
})
