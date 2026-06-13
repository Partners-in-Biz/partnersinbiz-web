import { legacyProjectAccessForUser } from '@/lib/projects/collaboration'
import { normalizeMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import type { ApiUser } from '@/lib/api/types'

describe('project legacy org access policy gating', () => {
  it('blocks broad legacy project access when the Projects module is disabled', () => {
    const user: ApiUser = {
      uid: 'uid-1',
      role: 'client',
      orgId: 'org-1',
      orgIds: ['org-1'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { crm: true, projects: false },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    }

    expect(legacyProjectAccessForUser(user, { orgId: 'org-1' })).toBeNull()
  })

  it('limits owned_or_linked project fallback access to directly linked project rows', () => {
    const user: ApiUser = {
      uid: 'uid-1',
      role: 'client',
      orgId: 'org-1',
      orgIds: ['org-1'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { projects: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    }

    expect(legacyProjectAccessForUser(user, { orgId: 'org-1', ownerUid: 'uid-2' })).toBeNull()
    expect(legacyProjectAccessForUser(user, { orgId: 'org-1', ownerUid: 'uid-1' })).toEqual(
      expect.objectContaining({ source: 'legacy_org' }),
    )
    expect(legacyProjectAccessForUser(user, { orgId: 'org-1', allowedUserIds: ['uid-1'] })).toEqual(
      expect.objectContaining({ source: 'legacy_org' }),
    )
  })
})
