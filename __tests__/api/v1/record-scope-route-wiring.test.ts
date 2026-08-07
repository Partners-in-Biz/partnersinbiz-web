/**
 * Route-level record-scope wiring tests.
 *
 * Verifies that the member read paths filter owned/linked rows through
 * `filterOwnedRowsForActor` when the member's orgMembers record scope is
 * `owned_or_linked`, while admins / agents and `all`-scoped members pass
 * through unchanged.
 *
 * Mirrors the unit coverage in __tests__/lib/orgMembers/record-scope.test.ts
 * at the API route boundary for:
 *   - research (portal GET + admin list)
 *   - client documents list
 *   - marketing (campaigns list, social posts list)
 */
import { NextRequest } from 'next/server'

// --- Firestore mock state -------------------------------------------------
let listDocs: Array<{ id: string; data: Record<string, unknown> }> = []
let memberPolicyData: Record<string, unknown> | null = null
let companyOwners: Record<string, { ownerUid?: string; assignedToUids?: string[] }> = {}
let contactOwners: Record<string, { ownerUid?: string; assignedToUids?: string[] }> = {}

const mockQueryGet = jest.fn(async () => ({
  docs: listDocs.map((doc) => ({ id: doc.id, data: () => doc.data })),
}))
const mockWhere = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn((name: string) => {
    if (name === 'orgMembers') {
      return {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(
            memberPolicyData
              ? { exists: true, data: () => memberPolicyData }
              : { exists: false, data: () => undefined },
          ),
        })),
      }
    }
    if (name === 'companies') {
      return {
        doc: jest.fn((id: string) => ({
          get: jest.fn().mockResolvedValue(
            companyOwners[id]
              ? { exists: true, data: () => ({ orgId: 'org-1', deleted: false, ...companyOwners[id] }) }
              : { exists: false, data: () => undefined },
          ),
        })),
      }
    }
    if (name === 'contacts') {
      return {
        doc: jest.fn((id: string) => ({
          get: jest.fn().mockResolvedValue(
            contactOwners[id]
              ? { exists: true, data: () => ({ orgId: 'org-1', deleted: false, ...contactOwners[id] }) }
              : { exists: false, data: () => undefined },
          ),
        })),
      }
    }
    return {
      where: mockWhere,
      limit: mockLimit,
      get: mockQueryGet,
    }
  }) },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_role: string, handler: any) => async (req: NextRequest, user: any, ctx?: any) =>
    handler(req, user, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTenant: (handler: any) => async (req: NextRequest, user: any, ctx?: any) =>
    handler(req, user, 'org-1', ctx),
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withPortalAuthAndRole: (_minRole: string, handler: any) => async (req: NextRequest, ..._args: any[]) =>
    handler(req, 'stean', 'org-1', 'member'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: {
    fromDate: jest.fn((date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), toDate: () => date })),
  },
}))

function scopedMemberPolicy(moduleKey: string, scope: 'all' | 'owned_or_linked'): Record<string, unknown> {
  return {
    role: 'member',
    accessPolicy: {
      preset: 'custom',
      modules: { [moduleKey]: true },
      recordScopes: { [moduleKey]: scope },
    },
  }
}

const memberUser = { uid: 'stean', role: 'client' as const, orgId: 'org-1', orgIds: ['org-1'], activeOrgId: 'org-1' }
const adminUser = { uid: 'admin-1', role: 'admin' as const, orgId: 'org-1' }

beforeEach(() => {
  jest.clearAllMocks()
  listDocs = []
  memberPolicyData = null
  companyOwners = {}
  contactOwners = {}
  const query = { where: mockWhere, limit: mockLimit, get: mockQueryGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
})

describe('record-scope wiring — campaigns list (marketing)', () => {
  const docs = () => [
    { id: 'c-mine', data: { orgId: 'org-1', name: 'Mine', deleted: false, createdBy: 'stean' } },
    { id: 'c-other', data: { orgId: 'org-1', name: 'Other', deleted: false, createdBy: 'peet' } },
  ]

  it('filters to owned campaigns for a member with owned_or_linked marketing scope', async () => {
    memberPolicyData = scopedMemberPolicy('marketing', 'owned_or_linked')
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/campaigns/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/campaigns?orgId=org-1'), memberUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((campaign: { id: string }) => campaign.id)).toEqual(['c-mine'])
    expect(body.meta.total).toBe(1)
  })

  it('passes all campaigns through for a member with all marketing scope', async () => {
    memberPolicyData = scopedMemberPolicy('marketing', 'all')
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/campaigns/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/campaigns?orgId=org-1'), memberUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((campaign: { id: string }) => campaign.id)).toEqual(['c-mine', 'c-other'])
    expect(body.meta.total).toBe(2)
  })

  it('passes all campaigns through for admins (unchanged)', async () => {
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/campaigns/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/campaigns?orgId=org-1'), adminUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((campaign: { id: string }) => campaign.id)).toEqual(['c-mine', 'c-other'])
  })
})

describe('record-scope wiring — social posts list (marketing)', () => {
  const docs = () => [
    { id: 'p-mine', data: { orgId: 'org-1', content: { text: 'Mine' }, accountScope: 'organization', createdBy: 'stean' } },
    { id: 'p-other', data: { orgId: 'org-1', content: { text: 'Other' }, accountScope: 'organization', createdBy: 'peet' } },
    { id: 'p-linked', data: { orgId: 'org-1', content: { text: 'Linked' }, accountScope: 'organization', createdBy: 'peet', companyIds: ['co-owned'] } },
  ]

  it('filters to owned / CRM-linked posts for a member with owned_or_linked marketing scope', async () => {
    memberPolicyData = scopedMemberPolicy('marketing', 'owned_or_linked')
    companyOwners = { 'co-owned': { ownerUid: 'stean' } }
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/social/posts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/posts?orgId=org-1'), memberUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((post: { id: string }) => post.id)).toEqual(['p-mine', 'p-linked'])
    expect(body.meta.total).toBe(2)
  })

  it('passes all posts through for a member with all marketing scope', async () => {
    memberPolicyData = scopedMemberPolicy('marketing', 'all')
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/social/posts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/posts?orgId=org-1'), memberUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((post: { id: string }) => post.id)).toEqual(['p-mine', 'p-other', 'p-linked'])
  })
})

describe('record-scope wiring — client documents list (documents)', () => {
  const docs = () => [
    { id: 'd-mine', data: { orgId: 'org-1', title: 'Mine', status: 'internal_draft', createdBy: 'stean', deleted: false } },
    { id: 'd-other', data: { orgId: 'org-1', title: 'Other', status: 'approved', createdBy: 'peet', linked: { clientOrgIds: ['org-1'] }, deleted: false } },
  ]

  it('passes all documents through for admins (unchanged)', async () => {
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/client-documents/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/client-documents?orgId=org-1'), adminUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((doc: { id: string }) => doc.id).sort()).toEqual(['d-mine', 'd-other'].sort())
  })

  it('keeps only owned documents for a member with owned_or_linked documents scope', async () => {
    memberPolicyData = scopedMemberPolicy('documents', 'owned_or_linked')
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/client-documents/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/client-documents?orgId=org-1'), memberUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((doc: { id: string }) => doc.id)).toEqual(['d-mine'])
  })
})

describe('record-scope wiring — research admin list', () => {
  const docs = () => [
    { id: 'r-mine', data: { orgId: 'org-1', title: 'Mine', deleted: false, createdBy: 'stean' } },
    { id: 'r-other', data: { orgId: 'org-1', title: 'Other', deleted: false, createdBy: 'peet' } },
  ]

  it('passes all research items through for admins (unchanged)', async () => {
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/research/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/research?orgId=org-1'), adminUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((item: { id: string }) => item.id)).toEqual(['r-mine', 'r-other'])
  })
})

describe('record-scope wiring — portal research GET', () => {
  const docs = () => [
    { id: 'r-mine', data: { orgId: 'org-1', title: 'Mine', visibility: 'client_visible', deleted: false, createdBy: 'stean' } },
    { id: 'r-other', data: { orgId: 'org-1', title: 'Other', visibility: 'client_visible', deleted: false, createdBy: 'peet' } },
  ]

  it('filters to owned research items for a member with owned_or_linked research scope', async () => {
    memberPolicyData = scopedMemberPolicy('research', 'owned_or_linked')
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/portal/research/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/research'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((item: { id: string }) => item.id)).toEqual(['r-mine'])
  })

  it('passes all research items through for a member with all research scope', async () => {
    memberPolicyData = scopedMemberPolicy('research', 'all')
    listDocs = docs()
    const { GET } = await import('@/app/api/v1/portal/research/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/research'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((item: { id: string }) => item.id)).toEqual(['r-mine', 'r-other'])
  })
})
