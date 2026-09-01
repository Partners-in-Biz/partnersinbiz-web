import {
  isOrgPersonProfileTwin,
  ownerUidForRehome,
  rehomePersonProfilePatch,
} from '@/lib/social/rehome-org-person-profiles'

describe('isOrgPersonProfileTwin', () => {
  it('matches known hide-list ids and org-scoped person types', () => {
    expect(isOrgPersonProfileTwin('z6jekgWOpRJs229kbd4I', { platform: 'linkedin' })).toBe(true)
    expect(isOrgPersonProfileTwin('new-1', {
      accountScope: 'org',
      platform: 'linkedin',
      accountType: 'personal',
    })).toBe(true)
    expect(isOrgPersonProfileTwin('ig-1', {
      accountScope: 'org',
      platform: 'instagram',
      accountType: 'business',
    })).toBe(false)
    expect(isOrgPersonProfileTwin('page-1', {
      accountScope: 'org',
      platform: 'linkedin',
      accountType: 'page',
    })).toBe(false)
    expect(isOrgPersonProfileTwin('personal-1', {
      accountScope: 'personal',
      platform: 'linkedin',
      accountType: 'personal',
    })).toBe(false)
  })
})

describe('ownerUidForRehome', () => {
  it('prefers connectedBy, then a matching personal twin', () => {
    expect(ownerUidForRehome({ connectedBy: 'uid-peet', platform: 'linkedin', platformAccountId: 'urn:1' }, new Map())).toBe('uid-peet')
    expect(ownerUidForRehome(
      { connectedBy: 'oauth', platform: 'linkedin', platformAccountId: 'urn:1' },
      new Map([['linkedin:urn:1', 'uid-from-twin']]),
    )).toBe('uid-from-twin')
    expect(rehomePersonProfilePatch('uid-peet')).toEqual({
      accountScope: 'personal',
      ownerUid: 'uid-peet',
      isDefault: false,
      marketingOwner: 'personal',
    })
  })
})
