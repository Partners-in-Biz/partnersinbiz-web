import {
  addProjectToUserLibrary,
  listUserLibraryProjectIds,
  projectUserLibraryLinkId,
  removeProjectFromUserLibrary,
  type ProjectUserLibraryRepository,
  type ProjectUserLibraryLink,
} from '@/lib/projects/user-library'

class MemoryRepository implements ProjectUserLibraryRepository {
  readonly rows = new Map<string, ProjectUserLibraryLink>()

  async get(id: string) {
    return this.rows.get(id) ?? null
  }

  async list(orgId: string, userId: string) {
    return [...this.rows.values()].filter((row) => row.orgId === orgId && row.userId === userId)
  }

  async set(id: string, row: ProjectUserLibraryLink) {
    this.rows.set(id, row)
  }
}

describe('per-user project library', () => {
  it('uses the user, organisation and project as the stable link identity', () => {
    expect(projectUserLibraryLinkId({ orgId: 'org-1', userId: 'user-1', projectId: 'project-1' }))
      .toBe(projectUserLibraryLinkId({ orgId: 'org-1', userId: 'user-1', projectId: 'project-1' }))
    expect(projectUserLibraryLinkId({ orgId: 'org-1', userId: 'user-2', projectId: 'project-1' }))
      .not.toBe(projectUserLibraryLinkId({ orgId: 'org-1', userId: 'user-1', projectId: 'project-1' }))
  })

  it('shows only active links for the current user and organisation', async () => {
    const repository = new MemoryRepository()
    await addProjectToUserLibrary({ orgId: 'org-1', userId: 'user-1', projectId: 'project-1', companyId: 'company-1' }, { repository, now: () => 'now' })
    await addProjectToUserLibrary({ orgId: 'org-1', userId: 'user-2', projectId: 'project-2' }, { repository, now: () => 'now' })
    await addProjectToUserLibrary({ orgId: 'org-2', userId: 'user-1', projectId: 'project-3' }, { repository, now: () => 'now' })

    expect(await listUserLibraryProjectIds('org-1', 'user-1', { repository })).toEqual(['project-1'])
  })

  it('removes only the personal sidebar link and can restore it later', async () => {
    const repository = new MemoryRepository()
    const input = { orgId: 'org-1', userId: 'user-1', projectId: 'project-1', companyId: 'company-1' }
    await addProjectToUserLibrary(input, { repository, now: () => 'first' })
    await removeProjectFromUserLibrary(input, { repository, now: () => 'removed' })
    expect(await listUserLibraryProjectIds('org-1', 'user-1', { repository })).toEqual([])

    const restored = await addProjectToUserLibrary(input, { repository, now: () => 'restored' })
    expect(restored.active).toBe(true)
    expect(restored.addedAt).toBe('restored')
    expect(restored.removedAt).toBeNull()
    expect(await listUserLibraryProjectIds('org-1', 'user-1', { repository })).toEqual(['project-1'])
  })
})
