// __tests__/lib/auth/portal-middleware.test.ts
//
// Regression tests for withPortalAuthAndRole:
//   - implicit admin -> owner fallback removed
//   - active-membership predicate governs role resolution (disabled / revoked /
//     deleted / inactive rows never yield a role)
//   - assigned platform admins (allowedOrgIds / home org) keep access with an
//     admin ceiling, never implicit owner
//   - stale sessions and org switch attempts are rejected

import { NextRequest } from 'next/server'

const mockVerifySessionCookie = jest.fn()
const mockUserDocGet = jest.fn()
const mockMemberDocGet = jest.fn()
const mockOrgDocGet = jest.fn()
const mockMemberWhere = jest.fn()
const mockMemberGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: mockVerifySessionCookie },
  adminDb: { collection: mockCollection },
}))

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import type { OrgRole } from '@/lib/organizations/types'

type MemberRow = Record<string, unknown>

let memberDocs: Array<{ id: string; data: () => MemberRow }> = []
let orgDataByOrg: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {}
let userData: Record<string, unknown> = {}

function setUser(data: Record<string, unknown>) {
  userData = data
}

function setMembers(rows: Array<{ orgId: string; row?: MemberRow }>) {
  memberDocs = rows.map(({ orgId, row }) => ({
    id: `${orgId}_user-1`,
    data: () => ({ orgId, uid: 'user-1', ...(row ?? {}) }),
  }))
}

function setOrgs(orgs: Record<string, { exists?: boolean; data?: Record<string, unknown> }>) {
  orgDataByOrg = Object.fromEntries(
    Object.entries(orgs).map(([orgId, cfg]) => [
      orgId,
      {
        exists: cfg.exists ?? true,
        data: () => ({ deleted: false, archived: false, status: 'active', ...(cfg.data ?? {}) }),
      },
    ])
  )
}

function handler(req: NextRequest, uid: string, orgId: string, role: OrgRole) {
  return new Response(JSON.stringify({ uid, orgId, role }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(url = 'http://localhost/api/v1/portal/test'): NextRequest {
  return new NextRequest(url, { headers: { Cookie: '__session=valid' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  memberDocs = []
  orgDataByOrg = {}
  userData = {}
  mockVerifySessionCookie.mockResolvedValue({ uid: 'user-1' })
  mockUserDocGet.mockResolvedValue({ exists: true, data: () => userData })
  mockMemberDocGet.mockResolvedValue({ exists: false, data: () => ({}) })
  mockOrgDocGet.mockResolvedValue({ exists: false, data: () => ({}) })
  mockMemberWhere.mockReturnValue({ get: mockMemberGet })
  mockMemberGet.mockImplementation(() => Promise.resolve({ docs: memberDocs }))

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return { doc: () => ({ get: mockUserDocGet }) }
    }
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

describe('withPortalAuthAndRole — session handling', () => {
  it('returns 401 without a session cookie', async () => {
    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(new NextRequest('http://localhost/api/v1/portal/test'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the session cookie is stale / fails verification', async () => {
    mockVerifySessionCookie.mockRejectedValue(new Error('token expired'))
    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user doc is missing', async () => {
    mockUserDocGet.mockResolvedValue({ exists: false })
    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest())
    expect(res.status).toBe(404)
  })
})

describe('withPortalAuthAndRole — admin owner fallback removed', () => {
  it('does NOT grant owner to an admin with no membership row', async () => {
    setUser({ role: 'admin', orgId: 'pib-platform-owner' })
    setMembers([])
    setOrgs({ 'pib-platform-owner': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.role).toBe('admin') // assigned home scope ceiling — not owner
  })

  it('does NOT grant owner to an admin entering a client org via allowedOrgIds', async () => {
    setUser({ role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['client-org'] })
    setMembers([])
    setOrgs({ 'client-org': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const req = makeRequest('http://localhost/api/v1/portal/test?orgId=client-org')
    const res = await wrapped(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.orgId).toBe('client-org')
    expect(body.role).toBe('admin') // assigned-admin access preserved, owner NOT implicit
  })

  it('rejects an admin trying to enter an org outside their assigned scope', async () => {
    setUser({ role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: ['assigned-org'] })
    setMembers([])
    setOrgs({ 'assigned-org': {}, 'client-org': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const req = makeRequest('http://localhost/api/v1/portal/test?orgId=client-org')
    const res = await wrapped(req)
    expect(res.status).toBe(403)
  })

  it('returns an explicit membership role when an admin has an active orgMembers row', async () => {
    setUser({ role: 'admin', orgId: 'pib-platform-owner' })
    setMembers([{ orgId: 'member-org', row: { role: 'owner' } }])
    setOrgs({ 'member-org': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const req = makeRequest('http://localhost/api/v1/portal/test?orgId=member-org')
    const res = await wrapped(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.role).toBe('owner') // explicit active membership keeps its role
  })
})

describe('withPortalAuthAndRole — active membership rows only', () => {
  it('grants the member role for an active orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('member', handler)
    const res = await wrapped(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.role).toBe('member')
  })

  it('rejects a disabled orgMembers row (403 workspace membership not found)', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', disabled: true } }])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest('http://localhost/api/v1/portal/test?orgId=org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a revoked orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', revoked: true } }])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest('http://localhost/api/v1/portal/test?orgId=org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a deleted orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', deleted: true } }])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest('http://localhost/api/v1/portal/test?orgId=org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects an inactive orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', status: 'inactive' } }])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest('http://localhost/api/v1/portal/test?orgId=org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a member with insufficient role for the requested minRole', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'viewer' } }])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('admin', handler)
    const res = await wrapped(makeRequest())
    expect(res.status).toBe(403)
  })

  it('accepts a legacy organizations.members array entry as active membership', async () => {
    setUser({ role: 'client', orgId: 'legacy-org' })
    setMembers([])
    setOrgs({ 'legacy-org': { data: { members: [{ userId: 'user-1', role: 'viewer' }] } } })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.role).toBe('viewer')
  })

  it('rejects a legacy members array entry that is disabled', async () => {
    setUser({ role: 'client', orgId: 'legacy-org' })
    setMembers([])
    setOrgs({
      'legacy-org': { data: { members: [{ userId: 'user-1', role: 'viewer', disabled: true }] } },
    })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest('http://localhost/api/v1/portal/test?orgId=legacy-org'))
    expect(res.status).toBe(403)
  })

  it('rejects a client switching to an org they are not a member of (org switch attempt)', async () => {
    setUser({ role: 'client', orgId: 'org-a', activeOrgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {}, 'org-b': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const req = makeRequest('http://localhost/api/v1/portal/test?orgId=org-b')
    const res = await wrapped(req)
    expect(res.status).toBe(403)
  })

  it('rejects a stale session whose active org membership was removed (no rows at all)', async () => {
    setUser({ role: 'client', orgId: 'org-a', activeOrgId: 'org-a', orgIds: ['org-a'] })
    setMembers([])
    setOrgs({ 'org-a': {} })

    const wrapped = withPortalAuthAndRole('viewer', handler)
    const res = await wrapped(makeRequest())
    expect(res.status).toBe(400) // no active workspace resolves
  })
})
