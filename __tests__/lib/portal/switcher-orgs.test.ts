const mockMemberWhere = jest.fn()
const mockMemberDocGet = jest.fn()
const mockOrgDocGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { listPortalSwitcherOrgIds } from '@/lib/portal/switcher-orgs'

type MemberRow = Record<string, unknown>

let memberDocs: Array<{ id: string; data: () => MemberRow }> = []
let orgDataByOrg: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {}

function setMembers(rows: Array<{ orgId: string; row?: MemberRow }>) {
  memberDocs = rows.map(({ orgId, row }) => {
    const rowData = row ?? {}
    const identity = 'uid' in rowData || 'userId' in rowData ? {} : { uid: 'user-1' }
    return {
      id: `${orgId}_user-1`,
      data: () => ({ orgId, ...identity, ...rowData }),
    }
  })
}

function setOrgs(orgs: Record<string, { exists?: boolean; data?: Record<string, unknown> }>) {
  orgDataByOrg = Object.fromEntries(
    Object.entries(orgs).map(([orgId, cfg]) => [
      orgId,
      {
        exists: cfg.exists ?? true,
        data: () => ({ deleted: false, archived: false, status: 'active', ...(cfg.data ?? {}) }),
      },
    ]),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  memberDocs = []
  orgDataByOrg = {}
  mockMemberWhere.mockImplementation((field: string, _op: string, value: unknown) => ({
    get: async () => ({
      docs: memberDocs.filter((doc) => doc.data()[field] === value),
    }),
  }))
  mockMemberDocGet.mockResolvedValue({ exists: false, data: () => ({}) })
  mockOrgDocGet.mockResolvedValue({ exists: false, data: () => ({}) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'orgMembers') {
      return {
        where: mockMemberWhere,
        doc: (docId: string) => ({
          get: async () => {
            const found = memberDocs.find((doc) => doc.id === docId)
            if (found) return { exists: true, data: () => found.data() }
            return mockMemberDocGet()
          },
        }),
      }
    }
    if (name === 'organizations') {
      return {
        get: async () => ({
          docs: Object.entries(orgDataByOrg)
            .filter(([, cfg]) => cfg.exists)
            .map(([orgId, cfg]) => ({
              id: orgId,
              exists: true,
              data: cfg.data,
            })),
        }),
        doc: (orgId: string) => ({
          get: async () => {
            const cfg = orgDataByOrg[orgId]
            if (cfg) return { exists: cfg.exists, data: cfg.data }
            return mockOrgDocGet()
          },
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('listPortalSwitcherOrgIds', () => {
  it('lists an Org.members-only owner when accessScope is missing and orgMembers/users.orgIds are absent', async () => {
    setMembers([])
    setOrgs({
      'pib-platform-owner': { data: { members: [] } },
      'client-org': { data: { members: [{ userId: 'user-1', role: 'owner' }] } },
    })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    const orgIds = await listPortalSwitcherOrgIds('user-1', data)
    expect(orgIds).toContain('client-org')
    expect(orgIds).toContain('pib-platform-owner')
  })

  it('lists an Org.members-only owner when accessScope is none for a staff account on pib-platform-owner', async () => {
    setMembers([])
    setOrgs({
      'pib-platform-owner': { data: { members: [] } },
      'owned-client': {
        data: { members: [{ userId: 'user-1', role: 'owner', accessScope: 'none' }] },
      },
    })
    const data = { role: 'admin', orgId: 'pib-platform-owner', orgIds: [] }

    const orgIds = await listPortalSwitcherOrgIds('user-1', data)
    expect(orgIds).toContain('owned-client')
  })

  it('does not list orgs the signed-in user is not a member of', async () => {
    setMembers([])
    setOrgs({
      'pib-platform-owner': { data: { members: [] } },
      'someone-elses-org': {
        data: { members: [{ userId: 'other-user', role: 'owner', accessScope: 'all' }] },
      },
    })
    const data = { role: 'admin', orgId: 'pib-platform-owner' }

    const orgIds = await listPortalSwitcherOrgIds('user-1', data)
    expect(orgIds).not.toContain('someone-elses-org')
  })
})
