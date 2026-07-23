import { legacyProjectAccessForUser, filterProjectsForMemberScope } from '@/lib/projects/collaboration'
import { normalizeMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import type { ApiUser } from '@/lib/api/types'

const mockProjectMemberGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'projectMembers') {
        return {
          doc: () => ({ get: mockProjectMemberGet }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

describe('project legacy org access policy gating', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProjectMemberGet.mockResolvedValue({ exists: false })
  })

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

  it('recognizes multi-organisation project arrays for legacy full-scope access', () => {
    const user: ApiUser = {
      uid: 'uid-1',
      role: 'client',
      orgId: 'org-1',
      orgIds: ['org-1'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { projects: true },
        recordScopes: { projects: 'all' },
      }),
    }

    expect(legacyProjectAccessForUser(user, { clientOrgIds: ['org-2', 'org-1'] })).toEqual(
      expect.objectContaining({ source: 'legacy_org' }),
    )
  })

  it('filters owned_or_linked list to personally linked projects only', async () => {
    const user: ApiUser = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { projects: true },
        recordScopes: { projects: 'owned_or_linked' },
      }),
    }

    const scoped = await filterProjectsForMemberScope(user, [
      { id: 'ahs', orgId: 'pib-platform-owner', ownerUid: 'peet', name: 'AHS Law' },
      { id: 'mine', orgId: 'pib-platform-owner', ownerUid: 'stean', name: 'Mine' },
      { id: 'created', orgId: 'pib-platform-owner', createdBy: 'stean', name: 'Created' },
    ])

    expect(scoped.map((p) => p.id)).toEqual(['mine', 'created'])
  })

  it('keeps projects where the member has an active projectMembers row', async () => {
    mockProjectMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'contributor', orgId: 'pib-platform-owner' }),
    })
    const user: ApiUser = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { projects: true },
        recordScopes: { projects: 'owned_or_linked' },
      }),
    }

    const scoped = await filterProjectsForMemberScope(user, [
      { id: 'shared-board', orgId: 'pib-platform-owner', ownerUid: 'peet' },
    ])
    expect(scoped.map((p) => p.id)).toEqual(['shared-board'])
  })
})
