import {
  classifyCompanyAction,
  classifyContactAction,
  collectMemberSources,
  parseFlags,
  shouldMirrorUserAsClientContact,
  type ExistingPlatformCrmState,
} from '@/scripts/backfill-platform-owner-crm-relationships'

function emptyState(): ExistingPlatformCrmState {
  return {
    companyLinkedOrgIds: new Set(),
    companyNames: new Set(),
    companyDomains: new Set(),
    contactLinkedUserIds: new Set(),
    contactEmails: new Set(),
  }
}

describe('backfill-platform-owner-crm-relationships helpers', () => {
  it('defaults to dry-run and parses commit/org filters', () => {
    expect(parseFlags([])).toEqual({ dryRun: true })
    expect(parseFlags(['--commit', '--org-id', 'client-1'])).toEqual({
      dryRun: false,
      orgId: 'client-1',
    })
    expect(parseFlags(['--commit', '--dry-run'])).toEqual({ dryRun: true })
  })

  it('dedupes embedded organization members with orgMembers docs and skips synthetic agents', () => {
    const members = collectMemberSources(
      [
        { userId: 'uid-2', role: 'member', displayName: 'Embedded User' },
        { userId: 'agent:pip', role: 'owner', displayName: 'Pip' },
      ],
      [
        { id: 'org_uid-1', data: { uid: 'uid-1', firstName: 'Jane', lastName: 'Smith', role: 'admin' } },
        { id: 'org_uid-2', data: { uid: 'uid-2', firstName: 'John', lastName: 'Doe', role: 'owner' } },
      ],
    )

    expect(members).toEqual([
      { uid: 'uid-1', role: 'admin', displayName: 'Jane Smith', email: '' },
      { uid: 'uid-2', role: 'owner', displayName: 'John Doe', email: '' },
    ])
  })

  it('classifies existing companies by linked org, name, or domain', () => {
    const state = emptyState()
    state.companyLinkedOrgIds.add('client-1')
    state.companyNames.add('acme ltd')
    state.companyDomains.add('example.com')

    expect(classifyCompanyAction({
      orgId: 'client-1',
      orgName: 'Other Name',
      state,
    })).toBe('update')
    expect(classifyCompanyAction({
      orgId: 'client-2',
      orgName: 'Acme Ltd',
      state,
    })).toBe('update')
    expect(classifyCompanyAction({
      orgId: 'client-3',
      orgName: 'New Co',
      domain: 'https://example.com/path',
      state,
    })).toBe('update')
    expect(classifyCompanyAction({
      orgId: 'client-4',
      orgName: 'New Co',
      state,
    })).toBe('create')
  })

  it('classifies existing contacts by linked user or email', () => {
    const state = emptyState()
    state.contactLinkedUserIds.add('uid-1')
    state.contactEmails.add('person@example.com')

    expect(classifyContactAction({ uid: 'uid-1', state })).toBe('update')
    expect(classifyContactAction({ uid: 'uid-2', email: 'PERSON@example.com', state })).toBe('update')
    expect(classifyContactAction({ uid: 'uid-3', email: 'new@example.com', state })).toBe('create')
  })

  it('skips internal platform users when mirroring client contacts', () => {
    expect(shouldMirrorUserAsClientContact({
      uid: 'agent:pip',
      email: 'pip@partnersinbiz.online',
      userRole: 'ai',
    })).toBe(false)
    expect(shouldMirrorUserAsClientContact({
      uid: 'uid-1',
      email: 'peet.stander@partnersinbiz.online',
      userRole: 'admin',
    })).toBe(false)
    expect(shouldMirrorUserAsClientContact({
      uid: 'uid-2',
      email: 'client@example.com',
      userRole: 'client',
    })).toBe(true)
  })
})
