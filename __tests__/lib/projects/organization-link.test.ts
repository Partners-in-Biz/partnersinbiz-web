import { projectLinkedToOrganization } from '@/lib/projects/organization-link'

describe('project organisation linkage', () => {
  it('accepts scalar and multi-organisation legacy links only when no canonical record exists', async () => {
    const loadOrganizationAccess = jest.fn(async () => null)

    await expect(projectLinkedToOrganization({
      projectId: 'project-1',
      project: { clientOrgIds: ['org-a', 'org-b'] },
      orgId: 'org-b',
    }, { loadOrganizationAccess })).resolves.toBe(true)
    expect(loadOrganizationAccess).toHaveBeenCalledWith('project-1', 'org-b')
  })

  it('accepts an active canonical project-organisation record', async () => {
    const loadOrganizationAccess = jest.fn(async () => ({
      projectId: 'project-1', orgId: 'org-b', status: 'active', role: 'contributor',
    }))

    await expect(projectLinkedToOrganization({
      projectId: 'project-1', project: { orgId: 'org-a' }, orgId: 'org-b',
    }, { loadOrganizationAccess })).resolves.toBe(true)
  })

  it('rejects pending, revoked, or cross-project organisation records', async () => {
    for (const row of [
      { projectId: 'project-1', orgId: 'org-b', status: 'pending' },
      { projectId: 'project-1', orgId: 'org-b', status: 'revoked' },
      { projectId: 'project-other', orgId: 'org-b', status: 'active' },
    ]) {
      await expect(projectLinkedToOrganization({
        projectId: 'project-1', project: { orgId: 'org-a' }, orgId: 'org-b',
      }, { loadOrganizationAccess: async () => row })).resolves.toBe(false)
    }
  })

  it.each(['pending', 'revoked', 'disabled', 'removed'])('keeps a canonical %s tombstone authoritative over a legacy link', async (status) => {
    await expect(projectLinkedToOrganization({
      projectId: 'project-1', project: { clientOrgIds: ['org-b'] }, orgId: 'org-b',
    }, {
      loadOrganizationAccess: async () => ({ projectId: 'project-1', orgId: 'org-b', status }),
    })).resolves.toBe(false)
  })
})
