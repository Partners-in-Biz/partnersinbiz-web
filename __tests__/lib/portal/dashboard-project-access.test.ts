import type { ApiUser } from '@/lib/api/types'
import { normalizeMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { getPortalDashboardProjectSummary } from '@/lib/portal/dashboard-summary'

const mockProjectMemberGet = jest.fn()

type ProjectRow = { id: string; data: Record<string, unknown> }
const projectRows: ProjectRow[] = []

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'projects') {
        return {
          where: () => ({
            get: async () => ({
              docs: projectRows.map((row) => ({ id: row.id, data: () => row.data })),
            }),
          }),
        }
      }
      if (name === 'projectMembers') {
        return { doc: () => ({ get: mockProjectMemberGet }) }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(), increment: jest.fn() },
}))

describe('portal dashboard project visibility', () => {
  beforeEach(() => {
    projectRows.splice(0, projectRows.length,
      {
        id: 'foreign-project',
        data: {
          orgId: 'pib-platform-owner',
          name: 'Private client project',
          description: 'Must not appear for Stean',
          status: 'development',
          ownerUid: 'peet',
          updatedAt: '2026-08-12T10:00:00.000Z',
        },
      },
      {
        id: 'stean-project',
        data: {
          orgId: 'pib-platform-owner',
          name: 'Stean project',
          status: 'live',
          ownerUid: 'stean',
          updatedAt: '2026-08-12T09:00:00.000Z',
        },
      },
    )
    mockProjectMemberGet.mockResolvedValue({ exists: false })
  })

  it('excludes unlinked projects from a restricted member dashboard total and cards', async () => {
    const stean: ApiUser = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { projects: true },
        recordScopes: { projects: 'owned_or_linked' },
      }),
    }

    const summary = await getPortalDashboardProjectSummary('pib-platform-owner', stean)

    expect(summary).toEqual({
      total: 1,
      active: 1,
      recent: [expect.objectContaining({ id: 'stean-project', name: 'Stean project' })],
    })
  })
})
