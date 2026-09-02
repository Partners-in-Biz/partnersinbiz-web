import {
  accountAllowedForPublish,
  accountVisibleForWorkspace,
  brandKitDocId,
  campaignVisibleForScope,
  isCompanyLinkedAccount,
  isPersonalAccountRecord,
  ownerFieldsForWrite,
  recordCompanyId,
  recordVisibleForOwner,
  resolveMarketingOwnerFromSearchParams,
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

  it('hides LinkedIn person profiles from company social, even if they were saved as org-scoped', () => {
    expect(isCompanyLinkedAccount({
      accountScope: 'org',
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(false)
    expect(isCompanyLinkedAccount({
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(false)
    expect(isCompanyLinkedAccount({
      accountScope: 'personal',
      accountType: 'personal',
      platform: 'linkedin',
    })).toBe(false)
    expect(isCompanyLinkedAccount({
      accountScope: 'org',
      accountType: 'page',
      platform: 'linkedin',
    })).toBe(true)
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
    }, { personal: false })).toBe(false)
    expect(accountAllowedForPublish({
      accountScope: 'org',
      accountType: 'page',
      platform: 'linkedin',
      status: 'active',
    }, { personal: false })).toBe(true)
  })

  it('keeps organisation, CRM company, and personal accounts in separate buckets', () => {
    expect(accountVisibleForWorkspace({
      accountScope: 'org',
      accountType: 'page',
      platform: 'facebook',
    }, { personal: false })).toBe(true)
    expect(accountVisibleForWorkspace({
      accountScope: 'org',
      accountType: 'page',
      platform: 'facebook',
      companyId: 'co-1',
    }, { personal: false })).toBe(false)
    expect(accountVisibleForWorkspace({
      accountScope: 'org',
      accountType: 'page',
      platform: 'facebook',
      companyId: 'co-1',
    }, { personal: false, companyId: 'co-1' })).toBe(true)
    expect(accountVisibleForWorkspace({
      accountScope: 'org',
      accountType: 'page',
      platform: 'facebook',
    }, { personal: false, companyId: 'co-1' })).toBe(false)
    expect(accountAllowedForPublish({
      accountType: 'page',
      platform: 'facebook',
      status: 'active',
    }, { personal: false, companyId: 'co-1' })).toBe(false)
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

  it('filters company-workspace campaigns by companyId', () => {
    expect(campaignVisibleForScope({ companyId: 'co-1' }, { personal: false, uid: 'user-1', companyId: 'co-1' })).toBe(true)
    expect(campaignVisibleForScope({ companyId: 'co-2' }, { personal: false, uid: 'user-1', companyId: 'co-1' })).toBe(false)
    expect(campaignVisibleForScope({}, { personal: false, uid: 'user-1', companyId: 'co-1' })).toBe(false)
  })
})

describe('marketing owner helpers', () => {
  it('resolves company owners from search params and writes matching fields', () => {
    const owner = resolveMarketingOwnerFromSearchParams(new URLSearchParams('companyId=co-1'), 'user-1')
    expect(owner).toEqual({ owner: 'company', companyId: 'co-1' })
    expect(ownerFieldsForWrite(owner)).toEqual({
      workOwner: 'company',
      marketingOwner: 'company',
      companyId: 'co-1',
    })
    expect(brandKitDocId('pib-platform-owner', owner)).toBe('pib-platform-owner__company_co-1')
    expect(recordVisibleForOwner({ companyId: 'co-1' }, owner)).toBe(true)
    expect(recordVisibleForOwner({ companyId: 'co-2' }, owner)).toBe(false)
    expect(recordCompanyId({ companyId: 'co-1' })).toBe('co-1')
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
      profileType: '',
      accountScope: 'org',
      platform: 'linkedin',
    })).toBe('page')
    expect(storedAccountTypeForScope({
      profileType: 'personal',
      accountScope: 'org',
      platform: 'linkedin',
    })).toBe('personal')
    expect(storedAccountTypeForScope({
      profileType: 'personal',
      accountScope: 'personal',
      platform: 'twitter',
    })).toBe('personal')
  })
})
