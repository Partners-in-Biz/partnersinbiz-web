import { canAccessProject } from '@/lib/projects/access'
import { filterProjectItemsForAccess, filterInternalItemsForProjectAccess } from '@/lib/projects/collaboration'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

// Mock the platformAdmin module
jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(),
  isSuperAdmin: jest.fn(),
}))

describe('admin-only allowedOrgIds scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('restricted admin project access', () => {
    it('allows restricted admin to access projects in their home org', () => {
      const user: ApiUser = {
        uid: 'admin-1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a'],
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(false)
      ;(canAccessOrg as jest.Mock).mockImplementation((u, orgId) => {
        if (orgId === u.orgId) return true
        if (u.allowedOrgIds?.includes(orgId)) return true
        return false
      })

      expect(canAccessProject(user, { orgId: 'pib-platform-owner' })).toBe(true)
      expect(canAccessOrg).toHaveBeenCalledWith(user, 'pib-platform-owner')
    })

    it('allows restricted admin to access projects in explicitly allowed orgs', () => {
      const user: ApiUser = {
        uid: 'admin-1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a', 'org-b'],
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(false)
      ;(canAccessOrg as jest.Mock).mockImplementation((u, orgId) => {
        if (orgId === u.orgId) return true
        if (u.allowedOrgIds?.includes(orgId)) return true
        return false
      })

      expect(canAccessProject(user, { orgId: 'org-a' })).toBe(true)
      expect(canAccessProject(user, { orgId: 'org-b' })).toBe(true)
    })

    it('blocks restricted admin from accessing projects outside allowedOrgIds', () => {
      const user: ApiUser = {
        uid: 'admin-1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a'],
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(false)
      ;(canAccessOrg as jest.Mock).mockImplementation((u, orgId) => {
        if (orgId === u.orgId) return true
        if (u.allowedOrgIds?.includes(orgId)) return true
        return false
      })

      expect(canAccessProject(user, { orgId: 'org-b' })).toBe(false)
      expect(canAccessProject(user, { orgId: 'org-c' })).toBe(false)
      expect(canAccessOrg).toHaveBeenCalledWith(user, 'org-b')
      expect(canAccessOrg).toHaveBeenCalledWith(user, 'org-c')
    })

    it('blocks restricted admin when allowedOrgIds is empty', () => {
      const user: ApiUser = {
        uid: 'admin-1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: [],
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(false)
      ;(canAccessOrg as jest.Mock).mockReturnValue(false)

      expect(canAccessProject(user, { orgId: 'client-org' })).toBe(false)
    })
  })

  describe('super admin unrestricted access', () => {
    it('allows super admin to access any project regardless of allowedOrgIds', () => {
      const user: ApiUser = {
        uid: 'super-admin',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: [], // Empty but super admin
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(true)

      expect(canAccessProject(user, { orgId: 'any-org' })).toBe(true)
      expect(canAccessProject(user, { clientOrgId: 'another-org' })).toBe(true)
      expect(canAccessOrg).not.toHaveBeenCalled()
    })
  })

  describe('project access through multiple org fields', () => {
    it('checks all possible org fields for project access', () => {
      const user: ApiUser = {
        uid: 'admin-1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a'],
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(false)
      ;(canAccessOrg as jest.Mock).mockImplementation((u, orgId) => {
        if (orgId === u.orgId) return true
        if (u.allowedOrgIds?.includes(orgId)) return true
        return false
      })

      expect(canAccessProject(user, { sourceOrgId: 'org-a' })).toBe(true)
      expect(canAccessProject(user, { clientId: 'org-a' })).toBe(true)
      expect(canAccessProject(user, { clientOrgId: 'org-a' })).toBe(true)
      expect(canAccessProject(user, { recipientOrgId: 'org-a' })).toBe(true)
      expect(canAccessProject(user, { targetOrgId: 'org-a' })).toBe(true)
    })
  })
})

describe('org leakage prevention', () => {
  describe('filterProjectItemsForAccess prevents org leakage', () => {
    it('respects allowedOrgIds scoping for task items', () => {
      const items = [
        { id: 'task-1', title: 'Public task' },
        { id: 'task-2', title: 'Org A task', allowedOrgIds: ['org-a'] },
        { id: 'task-3', title: 'Org B task', allowedOrgIds: ['org-b'] },
        { id: 'task-4', title: 'Multi-org task', allowedOrgIds: ['org-a', 'org-c'] },
      ]

      const userOrgA: ApiUser = {
        uid: 'admin-1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a'],
      }

      const filtered = filterProjectItemsForAccess(items, {
        projectAccess: { role: 'manager', source: 'super_admin', canViewInternal: false },
        user: userOrgA,
      })

      expect(filtered.map((i) => i.id)).toEqual(['task-1', 'task-2', 'task-4'])
      expect(filtered.some((i) => i.id === 'task-3')).toBe(false) // Blocked: org-b not allowed
    })

    it('prevents cross-org data leakage through allowedUserIds', () => {
      const items = [
        { id: 'task-1', title: 'Public task' },
        { id: 'task-2', title: 'User A task', allowedUserIds: ['user-a'] },
        { id: 'task-3', title: 'User B task', allowedUserIds: ['user-b'] },
      ]

      const userA: ApiUser = {
        uid: 'user-a',
        role: 'admin',
        orgId: 'org-a',
      }

      const filtered = filterProjectItemsForAccess(items, {
        projectAccess: { role: 'contributor', source: 'project_member', canViewInternal: false },
        user: userA,
      })

      expect(filtered.map((i) => i.id)).toEqual(['task-1', 'task-2'])
      expect(filtered.some((i) => i.id === 'task-3')).toBe(false) // Blocked: user-b only
    })

    it('prevents role-based leakage without proper role assignment', () => {
      const items = [
        { id: 'task-1', title: 'Public task' },
        { id: 'task-2', title: 'Manager only', allowedRoleIds: ['manager'] },
        { id: 'task-3', title: 'Owner only', allowedRoleIds: ['owner'] },
      ]

      const viewerUser: ApiUser = {
        uid: 'viewer-1',
        role: 'admin',
        orgId: 'org-a',
      }

      const filtered = filterProjectItemsForAccess(items, {
        projectAccess: { role: 'viewer', source: 'project_member', canViewInternal: false },
        user: viewerUser,
      })

      expect(filtered.map((i) => i.id)).toEqual(['task-1'])
      expect(filtered.some((i) => i.id === 'task-2')).toBe(false)
      expect(filtered.some((i) => i.id === 'task-3')).toBe(false)
    })
  })

  describe('internal items leakage prevention', () => {
    it('hides internal-only items from external collaborators', () => {
      const items = [
        { id: 'public-1', title: 'Public task' },
        { id: 'internal-1', title: 'Internal notes', internalOnly: true },
        { id: 'public-2', title: 'Another public task' },
      ]

      const externalResult = filterInternalItemsForProjectAccess(items, false)
      expect(externalResult.map((i) => i.id)).toEqual(['public-1', 'public-2'])

      const internalResult = filterInternalItemsForProjectAccess(items, true)
      expect(internalResult.map((i) => i.id)).toEqual(['public-1', 'internal-1', 'public-2'])
    })

    it('respects visibility field over internalOnly', () => {
      const items = [
        { id: 'explicit-internal', title: 'Explicit internal', visibility: 'internal' },
        { id: 'public', title: 'Public task', visibility: 'public' },
      ]

      const filtered = filterInternalItemsForProjectAccess(items, false)
      expect(filtered.map((i) => i.id)).toEqual(['public'])
    })
  })

  describe('org isolation in project data', () => {
    it('ensures project access is isolated by orgId', () => {
      const userA: ApiUser = {
        uid: 'admin-a',
        role: 'admin',
        orgId: 'platform-owner',
        allowedOrgIds: ['org-a'],
      }

      const userB: ApiUser = {
        uid: 'admin-b',
        role: 'admin',
        orgId: 'platform-owner',
        allowedOrgIds: ['org-b'],
      }

      ;(isSuperAdmin as jest.Mock).mockReturnValue(false)
      ;(canAccessOrg as jest.Mock).mockImplementation((u, orgId) => {
        if (orgId === u.orgId) return true
        if (u.allowedOrgIds?.includes(orgId)) return true
        return false
      })

      const projectA = { orgId: 'org-a', name: 'Project A' }
      const projectB = { orgId: 'org-b', name: 'Project B' }

      expect(canAccessProject(userA, projectA)).toBe(true)
      expect(canAccessProject(userA, projectB)).toBe(false)

      expect(canAccessProject(userB, projectA)).toBe(false)
      expect(canAccessProject(userB, projectB)).toBe(true)
    })
  })
})
