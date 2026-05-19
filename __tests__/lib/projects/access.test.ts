import { canAccessProject } from '@/lib/projects/access'
import type { ApiUser } from '@/lib/api/types'

describe('canAccessProject', () => {
  it('allows a restricted admin to open a project in their home platform org', () => {
    const user: ApiUser = {
      uid: 'admin-1',
      role: 'admin',
      orgId: 'pib-platform-owner',
      allowedOrgIds: ['org-a'],
    }

    expect(canAccessProject(user, { orgId: 'pib-platform-owner' })).toBe(true)
  })

  it('allows a restricted admin to open projects in assigned client orgs', () => {
    const user: ApiUser = {
      uid: 'admin-1',
      role: 'admin',
      orgId: 'pib-platform-owner',
      allowedOrgIds: ['org-a'],
    }

    expect(canAccessProject(user, { orgId: 'org-a' })).toBe(true)
  })

  it('blocks a restricted admin from projects outside their assigned orgs', () => {
    const user: ApiUser = {
      uid: 'admin-1',
      role: 'admin',
      orgId: 'pib-platform-owner',
      allowedOrgIds: ['org-a'],
    }

    expect(canAccessProject(user, { orgId: 'org-b' })).toBe(false)
  })

  it('allows client users through any linked project org id', () => {
    const user: ApiUser = {
      uid: 'client-1',
      role: 'client',
      orgIds: ['org-a', 'org-b'],
    }

    expect(canAccessProject(user, { clientOrgId: 'org-b' })).toBe(true)
  })
})
