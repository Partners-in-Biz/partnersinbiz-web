// __tests__/lib/auth/crm-middleware.test.ts
//
// Regression tests for withCrmAuth active-membership enforcement on the
// cookie (browser session) and delegation (Messages / interactive Hermes)
// paths:
//   - disabled / revoked / deleted / inactive orgMembers rows are rejected
//   - stale delegations minted for an org the user is no longer active in are
//     rejected at use time
//   - org switch attempts (X-Org-Id outside scope) are rejected
//   - restricted-admin API keys cannot cross their org scope

import { NextRequest } from 'next/server'

const mockVerifySessionCookie = jest.fn()
const mockUserDocGet = jest.fn()
const mockMemberDocGet = jest.fn()
const mockOrgDocGet = jest.fn()
const mockMemberWhere = jest.fn()
const mockMemberGet = jest.fn()
const mockCollection = jest.fn()
const mockResolveDelegationTokenUser = jest.fn()
const mockResolveAgentApiKeyUser = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: mockVerifySessionCookie },
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/delegations', () => ({
  resolveDelegationTokenUser: (...args: unknown[]) => mockResolveDelegationTokenUser(...args),
  resolveDelegationBearerUser: (...args: unknown[]) => mockResolveDelegationTokenUser(...args),
}))

jest.mock('@/lib/api/auth', () => ({
  resolveAgentApiKeyUser: (...args: unknown[]) => mockResolveAgentApiKeyUser(...args),
}))

import { withCrmAuth } from '@/lib/auth/crm-middleware'

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

function handler(_req: NextRequest, ctx: { orgId: string; staffClientOrgId?: string }) {
  return new Response(JSON.stringify({
    ok: true,
    orgId: ctx.orgId,
    staffClientOrgId: ctx.staffClientOrgId ?? null,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function cookieRequest(orgId?: string): NextRequest {
  const url = orgId ? `http://localhost/api/v1/crm/contacts?orgId=${orgId}` : 'http://localhost/api/v1/crm/contacts'
  return new NextRequest(url, { headers: { Cookie: '__session=valid' } })
}

function bearerRequest(token: string, orgId?: string): NextRequest {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (orgId) headers['x-org-id'] = orgId
  return new NextRequest('http://localhost/api/v1/crm/contacts', { headers })
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
  mockResolveDelegationTokenUser.mockResolvedValue(null)
  mockResolveAgentApiKeyUser.mockResolvedValue(null)

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

describe('withCrmAuth — cookie path', () => {
  it('grants CRM access to an active member', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(200)
  })

  it('rejects a disabled orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', disabled: true } }])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a revoked orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', revoked: true } }])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a deleted orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', deleted: true } }])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects an inactive orgMembers row', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', status: 'inactive' } }])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a missing membership row (revoked entirely)', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a client attempting to switch to another org (org switch attempt)', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {}, 'org-b': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-b'))
    expect(res.status).toBe(403)
  })

  it('remaps PiB staff CRM onto pib-platform-owner when the portal asks for a client org', async () => {
    setUser({ role: 'client', orgId: 'pib-platform-owner' })
    setMembers([{ orgId: 'pib-platform-owner', row: { role: 'member' } }])
    setOrgs({ 'pib-platform-owner': {}, 'wS5pgwa6c9WbPocf4w0w': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('wS5pgwa6c9WbPocf4w0w'))
    expect(res.status).toBe(200)
    const body = await res.json() as { orgId: string; staffClientOrgId: string | null }
    expect(body.orgId).toBe('pib-platform-owner')
    expect(body.staffClientOrgId).toBe('wS5pgwa6c9WbPocf4w0w')
  })

  it('rejects an inactive organisation even with an active member row', async () => {
    setUser({ role: 'client', orgId: 'suspended-org' })
    setMembers([{ orgId: 'suspended-org', row: { role: 'member' } }])
    setOrgs({ 'suspended-org': { data: { deleted: false, status: 'suspended' } } })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('suspended-org'))
    expect(res.status).toBe(404)
  })

  it('rejects a stale session cookie (invalid token)', async () => {
    mockVerifySessionCookie.mockRejectedValue(new Error('stale session'))
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(cookieRequest('org-a'))
    expect(res.status).toBe(401)
  })
})

describe('withCrmAuth — delegation path (Messages / interactive Hermes)', () => {
  it('grants CRM access to a delegation scoped to an active membership', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {} })
    mockResolveDelegationTokenUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'theo',
      delegationId: 'dlg_1',
      actingForUserId: 'user-1',
      orgId: 'org-a',
      activeOrgId: 'org-a',
      orgIds: ['org-a'],
    })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_dlg_valid', 'org-a'))
    expect(res.status).toBe(200)
  })

  it('rejects a delegation when the underlying membership was revoked after mint (stale delegation)', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([]) // membership row deleted after the delegation was minted
    setOrgs({ 'org-a': {} })
    mockResolveDelegationTokenUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'theo',
      delegationId: 'dlg_stale',
      actingForUserId: 'user-1',
      orgId: 'org-a',
      activeOrgId: 'org-a',
      orgIds: ['org-a'],
    })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_dlg_stale', 'org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a delegation whose user membership is disabled', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member', disabled: true } }])
    setOrgs({ 'org-a': {} })
    mockResolveDelegationTokenUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'theo',
      delegationId: 'dlg_disabled',
      actingForUserId: 'user-1',
      orgId: 'org-a',
      activeOrgId: 'org-a',
      orgIds: ['org-a'],
    })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_dlg_disabled', 'org-a'))
    expect(res.status).toBe(403)
  })

  it('rejects a delegation attempting an org switch outside its scope', async () => {
    setUser({ role: 'client', orgId: 'org-a' })
    setMembers([{ orgId: 'org-a', row: { role: 'member' } }])
    setOrgs({ 'org-a': {}, 'org-b': {} })
    mockResolveDelegationTokenUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'theo',
      delegationId: 'dlg_1',
      actingForUserId: 'user-1',
      orgId: 'org-a',
      activeOrgId: 'org-a',
      orgIds: ['org-a'],
    })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_dlg_valid', 'org-b'))
    expect(res.status).toBe(403)
  })

  it('remaps PiB staff delegations from a client-org chat onto the platform CRM book', async () => {
    setUser({ role: 'client', orgId: 'pib-platform-owner' })
    setMembers([{ orgId: 'pib-platform-owner', row: { role: 'member' } }])
    setOrgs({ 'pib-platform-owner': {}, 'wS5pgwa6c9WbPocf4w0w': {} })
    mockResolveDelegationTokenUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'theo',
      delegationId: 'dlg_staff',
      actingForUserId: 'user-1',
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      activeOrgId: 'wS5pgwa6c9WbPocf4w0w',
      orgIds: ['wS5pgwa6c9WbPocf4w0w', 'pib-platform-owner'],
    })

    const res = await withCrmAuth('member', handler)(bearerRequest('pib_dlg_staff', 'wS5pgwa6c9WbPocf4w0w'))
    expect(res.status).toBe(200)
    const body = await res.json() as { orgId: string; staffClientOrgId: string | null }
    expect(body.orgId).toBe('pib-platform-owner')
    expect(body.staffClientOrgId).toBe('wS5pgwa6c9WbPocf4w0w')
  })

  it('does not remap a client-org-only delegation that is not PiB staff', async () => {
    setUser({ role: 'client', orgId: 'wS5pgwa6c9WbPocf4w0w' })
    setMembers([])
    setOrgs({ 'pib-platform-owner': {}, 'wS5pgwa6c9WbPocf4w0w': {} })
    mockResolveDelegationTokenUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'user_delegation',
      agentId: 'theo',
      delegationId: 'dlg_client',
      actingForUserId: 'user-1',
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      activeOrgId: 'wS5pgwa6c9WbPocf4w0w',
      orgIds: ['wS5pgwa6c9WbPocf4w0w'],
    })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_dlg_client', 'wS5pgwa6c9WbPocf4w0w'))
    expect(res.status).toBe(403)
  })

  it('rejects an expired / revoked delegation token itself', async () => {
    mockResolveDelegationTokenUser.mockResolvedValue(null) // resolveDelegationTokenUser returns null for revoked/expired
    mockResolveAgentApiKeyUser.mockResolvedValue(null)

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_dlg_expired', 'org-a'))
    expect(res.status).toBe(401)
  })
})

describe('withCrmAuth — agent API key path', () => {
  it('rejects a per-agent API key crossing its scoped org', async () => {
    mockResolveAgentApiKeyUser.mockResolvedValue({
      uid: 'agent:theo',
      role: 'ai',
      authKind: 'agent_api_key',
      agentId: 'theo',
      apiKeyId: 'key_1',
      orgId: 'org-a',
    })
    setOrgs({ 'org-a': {}, 'org-b': {} })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_ag_other', 'org-b'))
    expect(res.status).toBe(403)
  })

  it('grants a per-agent API key in its scoped org', async () => {
    mockResolveAgentApiKeyUser.mockResolvedValue({
      uid: 'agent:theo',
      role: 'ai',
      authKind: 'agent_api_key',
      agentId: 'theo',
      apiKeyId: 'key_1',
      orgId: 'org-a',
    })
    setOrgs({ 'org-a': {} })

    const res = await withCrmAuth('viewer', handler)(bearerRequest('pib_ag_ok', 'org-a'))
    expect(res.status).toBe(200)
  })
})
