const mockDocuments = new Map<string, Record<string, unknown>>()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (collectionName: string) => ({
      doc: (documentId: string) => ({
        get: async () => {
          const data = mockDocuments.get(`${collectionName}/${documentId}`)
          return {
            id: documentId,
            exists: Boolean(data),
            data: () => data,
          }
        },
      }),
    }),
  },
}))

import type { ApiUser } from '@/lib/api/types'
import { getProjectForUser } from '@/lib/projects/access'
import { resolveProjectAccessForUser } from '@/lib/projects/collaboration'

const user: ApiUser = {
  uid: 'multi-org-user',
  role: 'client',
  orgId: 'org-b',
  orgIds: ['org-b', 'org-a'],
}

beforeEach(() => {
  mockDocuments.clear()
  mockDocuments.set('projects/project-1', {
    ownerOrgId: 'source-org',
    clientOrgIds: ['org-a', 'org-b'],
  })
  mockDocuments.set('projectOrganizations/project-1_org-a', {
    projectId: 'project-1',
    orgId: 'org-a',
    role: 'viewer',
    status: 'active',
  })
  mockDocuments.set('projectOrganizations/project-1_org-b', {
    projectId: 'project-1',
    orgId: 'org-b',
    role: 'manager',
    status: 'active',
  })
})

describe('organisation-scoped project access', () => {
  it('uses the exact project-organisation role instead of another organisation role', async () => {
    const project = mockDocuments.get('projects/project-1')!

    await expect(resolveProjectAccessForUser('project-1', user, project, 'org-a')).resolves.toEqual({
      role: 'viewer',
      source: 'project_organization',
      canViewInternal: false,
    })
    await expect(resolveProjectAccessForUser('project-1', user, project)).resolves.toEqual({
      role: 'manager',
      source: 'project_organization',
      canViewInternal: false,
    })
  })

  it('does not carry a direct membership from one organisation into another', async () => {
    mockDocuments.set('projectMembers/project-1_multi-org-user', {
      projectId: 'project-1',
      uid: 'multi-org-user',
      orgId: 'org-b',
      role: 'manager',
      status: 'active',
      memberType: 'external',
    })

    const access = await getProjectForUser('project-1', user, 'org-a')

    expect(access.ok).toBe(true)
    if (access.ok) expect(access.projectAccess?.role).toBe('viewer')
  })

  it('rejects a requested organisation that is not linked to the project', async () => {
    mockDocuments.set('projects/project-1', {
      ownerOrgId: 'source-org',
      clientOrgIds: ['org-b'],
    })
    mockDocuments.delete('projectOrganizations/project-1_org-a')

    await expect(getProjectForUser('project-1', user, 'org-a')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
  })

  it.each(['pending', 'revoked', 'disabled', 'removed'])('does not fall back to a legacy org link after a canonical %s record', async (status) => {
    mockDocuments.set('projectOrganizations/project-1_org-b', {
      projectId: 'project-1', orgId: 'org-b', role: 'manager', status,
    })

    await expect(resolveProjectAccessForUser(
      'project-1', user, mockDocuments.get('projects/project-1')!, 'org-b',
    )).resolves.toBeNull()
    await expect(getProjectForUser('project-1', user, 'org-b')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
  })
})
