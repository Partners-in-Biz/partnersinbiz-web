import {
  accountAllowedForPublish,
  campaignVisibleForScope,
  isCompanyLinkedAccount,
  isPersonalAccountRecord,
  storedAccountTypeForScope,
} from '@/lib/social/account-scope'

describe('isCompanyLinkedAccount', () => {
  it('hides personal-scoped rows even when they look like pages', () => {
    expect(isPersonalAccountRecord({ accountScope: 'personal' })).toBe(true)
    expect(isCompanyLinkedAccount({
      accountScope: 'personal',
      accountType: 'page',
      platform: 'facebook',
    })).toBe(false)
  })

  it('hides person-profile twins from company social, even if they were saved as org-scoped', () => {
    expect(isCompanyLinkedAccount({
      displayName: 'Peet Stander',
      accountType: 'personal',
      platform: 'twitter',
    } as { accountType?: string; platform?: string })).toBe(false)
    expect(isCompanyLinkedAccount({
      accountScope: 'org',
      accountType: 'personal',
      platform: 'twitter',
    })).toBe(false)
    expect(isCompanyLinkedAccount({
      accountScope: 'org',
      accountType: 'personal',
      platform: 'facebook',
    })).toBe(false)
  })

  it('keeps org-scoped LinkedIn personal profiles on company social so posting works before CMA', () => {
    expect(isCompanyLinkedAccount({
      accountScope: 'org',
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(true)
    expect(isCompanyLinkedAccount({
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(true)
    expect(isCompanyLinkedAccount({
      accountScope: 'personal',
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(false)
  })

  it('keeps company pages, business accounts, and org brand handles', () => {
    expect(isCompanyLinkedAccount({ accountType: 'page', platform: 'facebook' })).toBe(true)
    expect(isCompanyLinkedAccount({ accountType: 'business', platform: 'instagram' })).toBe(true)
    expect(isCompanyLinkedAccount({ accountScope: 'org', accountType: 'business', platform: 'twitter' })).toBe(true)
    expect(isCompanyLinkedAccount({ platform: 'bluesky' })).toBe(true)
    expect(isCompanyLinkedAccount({ accountScope: 'org', platform: 'bluesky' })).toBe(true)
  })

  it('keeps org Instagram rows company-linked even when accountType is omitted', () => {
    expect(isCompanyLinkedAccount({
      platform: 'instagram',
      status: 'active',
    })).toBe(true)
    expect(isCompanyLinkedAccount({
      accountScope: 'org',
      platform: 'instagram',
    })).toBe(true)
    expect(isCompanyLinkedAccount({
      accountScope: 'personal',
      platform: 'instagram',
    })).toBe(false)
  })

  it('keeps personal bluesky out of company social', () => {
    expect(isCompanyLinkedAccount({
      accountScope: 'personal',
      platform: 'bluesky',
      accountType: 'personal',
    })).toBe(false)
  })
})

describe('accountAllowedForPublish', () => {
  it('blocks org publishing to person-profile twins', () => {
    expect(accountAllowedForPublish({
      accountScope: 'org',
      accountType: 'personal',
      platform: 'twitter',
      status: 'active',
    }, { personal: false })).toBe(false)
    expect(accountAllowedForPublish({
      accountType: 'page',
      platform: 'facebook',
      status: 'active',
    }, { personal: false })).toBe(true)
    expect(accountAllowedForPublish({
      accountScope: 'org',
      accountType: 'personal',
      platform: 'linkedin',
      status: 'active',
    }, { personal: false })).toBe(true)
  })

  it('only allows the owner personal accounts for personal publishing', () => {
    expect(accountAllowedForPublish({
      accountScope: 'personal',
      ownerUid: 'user-1',
      status: 'active',
      platform: 'linkedin',
    }, { personal: true, ownerUid: 'user-1' })).toBe(true)
    expect(accountAllowedForPublish({
      accountScope: 'personal',
      ownerUid: 'user-2',
      status: 'active',
      platform: 'linkedin',
    }, { personal: true, ownerUid: 'user-1' })).toBe(false)
    expect(accountAllowedForPublish({
      accountType: 'page',
      platform: 'facebook',
      status: 'active',
    }, { personal: true, ownerUid: 'user-1' })).toBe(false)
  })
})

describe('campaignVisibleForScope', () => {
  it('keeps organisation and personal campaigns on separate lists', () => {
    expect(campaignVisibleForScope({ accountScope: 'org' }, { personal: false, uid: 'user-1' })).toBe(true)
    expect(campaignVisibleForScope({}, { personal: false, uid: 'user-1' })).toBe(true)
    expect(campaignVisibleForScope({ accountScope: 'personal', ownerUid: 'user-1' }, { personal: false, uid: 'user-1' })).toBe(false)
    expect(campaignVisibleForScope({ accountScope: 'personal', ownerUid: 'user-1' }, { personal: true, uid: 'user-1' })).toBe(true)
    expect(campaignVisibleForScope({ accountScope: 'personal', ownerUid: 'user-2' }, { personal: true, uid: 'user-1' })).toBe(false)
    expect(campaignVisibleForScope({ accountScope: 'org' }, { personal: true, uid: 'user-1' })).toBe(false)
  })
})

describe('storedAccountTypeForScope', () => {
  it('stores org-connected non-page platforms as business so they stay on company social', () => {
    expect(storedAccountTypeForScope({
      profileType: 'personal',
      accountScope: 'org',
      platform: 'twitter',
    })).toBe('business')
    expect(storedAccountTypeForScope({
      profileType: 'page',
      accountScope: 'org',
      platform: 'facebook',
    })).toBe('page')
    expect(storedAccountTypeForScope({
      profileType: 'personal',
      accountScope: 'personal',
      platform: 'twitter',
    })).toBe('personal')
  })
})
