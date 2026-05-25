import { adminProjectTaskLink, resolveOrgSlugForLink } from '@/lib/projects/links'

function collectionStub(slug: string | null) {
  const get = jest.fn().mockResolvedValue({
    exists: slug !== null,
    data: () => ({ slug }),
  })
  const doc = jest.fn(() => ({ get }))
  const whereGet = jest.fn().mockResolvedValue({ docs: [] })
  const where = jest.fn(() => ({ limit: () => ({ get: whereGet }) }))
  const collection = jest.fn(() => ({ doc, where }))
  return { db: { collection } as any, collection, doc, get, where }
}

describe('project admin links', () => {
  it('builds an org-scoped project task link that matches the routed admin page', async () => {
    const { db } = collectionStub('partners-in-biz')

    await expect(adminProjectTaskLink({
      db,
      orgId: 'pib-platform-owner',
      projectId: 'project-1',
      taskId: 'task-1',
    })).resolves.toBe('/admin/org/partners-in-biz/projects/project-1?taskId=task-1')
  })

  it('falls back to the projects list without using the removed /admin/projects/:id route', async () => {
    const { db } = collectionStub(null)

    await expect(adminProjectTaskLink({
      db,
      orgId: 'missing-org',
      projectId: 'project 1',
      taskId: 'task 1',
    })).resolves.toBe('/admin/projects?projectId=project%201&taskId=task%201')
  })

  it('resolves the organization slug from the canonical organization document', async () => {
    const { db, collection, doc } = collectionStub('acme')

    await expect(resolveOrgSlugForLink(db, 'org-1')).resolves.toBe('acme')
    expect(collection).toHaveBeenCalledWith('organizations')
    expect(doc).toHaveBeenCalledWith('org-1')
  })
})
