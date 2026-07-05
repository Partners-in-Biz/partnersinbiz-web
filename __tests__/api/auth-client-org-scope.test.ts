// __tests__/api/auth-client-org-scope.test.ts
//
// Regression tests for cross-tenant orgId injection: withAuth must reject a
// request-supplied scoped orgId (?orgId= query param or x-org-id header) when
// a `client` caller is not a member of that org. Previously the membership
// check only ran for role === 'admin', so any authenticated client could
// scope reads/writes to an arbitrary tenant on routes using the common
// resolveOrgId pattern.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    collection: jest.fn(),
  },
}))

jest.mock('@/lib/governance/maintenance', () => ({
  getMaintenanceState: jest.fn().mockResolvedValue({ enabled: false, message: '', ipAllowlist: [] }),
  isMaintenanceActiveNow: jest.fn().mockReturnValue(false),
  requestBypassesMaintenance: jest.fn().mockReturnValue(false),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'

const AI_API_KEY = 'test-ai-key-org-scope'
process.env.AI_API_KEY = AI_API_KEY

function makeReq(opts: { query?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost/api/v1/test${opts.query ?? ''}`, {
    headers: new Headers({ authorization: 'Bearer valid-id-token', ...(opts.headers ?? {}) }),
  })
}

/** Stub the Firestore users/{uid} doc (and any orgMembers lookups) for the caller. */
function mockUserDoc(data: Record<string, unknown>) {
  ;(adminAuth.verifyIdToken as jest.Mock).mockResolvedValue({ uid: 'caller-1' })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => ({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(
        name === 'users'
          ? { exists: true, data: () => data }
          : { exists: false, data: () => ({}) },
      ),
    }),
    where: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) }),
    }),
  }))
}

const handler = withAuth('client', async (_req, user) => apiSuccess({ uid: user.uid, role: user.role }))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('withAuth — client scoped-orgId enforcement', () => {
  it('rejects a client injecting another org via ?orgId= query param', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a' })
    const res = await handler(makeReq({ query: '?orgId=org-victim' }))
    expect(res.status).toBe(403)
  })

  it('rejects a client injecting another org via x-org-id header', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a' })
    const res = await handler(makeReq({ headers: { 'x-org-id': 'org-victim' } }))
    expect(res.status).toBe(403)
  })

  it('rejects a client with no org supplying any scoped orgId', async () => {
    mockUserDoc({ role: 'client' })
    const res = await handler(makeReq({ query: '?orgId=org-victim' }))
    expect(res.status).toBe(403)
  })

  it('allows a client scoping to their own orgId', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a' })
    const res = await handler(makeReq({ query: '?orgId=org-a' }))
    expect(res.status).toBe(200)
  })

  it('allows a client scoping to an org in their orgIds list', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a', orgIds: ['org-a', 'org-b'] })
    const res = await handler(makeReq({ headers: { 'x-org-id': 'org-b' } }))
    expect(res.status).toBe(200)
  })

  it('allows a client scoping to their activeOrgId', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a', activeOrgId: 'org-c' })
    const res = await handler(makeReq({ query: '?orgId=org-c' }))
    expect(res.status).toBe(200)
  })

  it('rejects an org outside orgIds even when others are valid', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a', orgIds: ['org-a', 'org-b'], activeOrgId: 'org-a' })
    const res = await handler(makeReq({ query: '?orgId=org-z' }))
    expect(res.status).toBe(403)
  })

  it('still runs the handler when no scoped orgId is supplied (fallback to user org)', async () => {
    mockUserDoc({ role: 'client', orgId: 'org-a' })
    const res = await handler(makeReq())
    expect(res.status).toBe(200)
  })

  it('does not restrict ai callers', async () => {
    const req = new NextRequest('http://localhost/api/v1/test?orgId=org-anything', {
      headers: new Headers({ authorization: `Bearer ${AI_API_KEY}` }),
    })
    const res = await handler(req)
    expect(res.status).toBe(200)
  })

  it('keeps enforcing allowedOrgIds for restricted admins', async () => {
    mockUserDoc({ role: 'admin', allowedOrgIds: ['org-a'] })
    const res = await handler(makeReq({ query: '?orgId=org-other' }))
    expect(res.status).toBe(403)
  })

  it('allows unrestricted admins to scope to any org', async () => {
    mockUserDoc({ role: 'admin' })
    const res = await handler(makeReq({ query: '?orgId=org-other' }))
    expect(res.status).toBe(200)
  })
})

describe('canAccessOrg — client branch', () => {
  const base: ApiUser = { uid: 'u1', role: 'client', authKind: 'firebase' }

  it('accepts orgId / orgIds / activeOrgId membership', () => {
    expect(canAccessOrg({ ...base, orgId: 'a' }, 'a')).toBe(true)
    expect(canAccessOrg({ ...base, orgId: 'a', orgIds: ['a', 'b'] }, 'b')).toBe(true)
    expect(canAccessOrg({ ...base, orgId: 'a', activeOrgId: 'c' }, 'c')).toBe(true)
  })

  it('rejects non-member orgs and empty values', () => {
    expect(canAccessOrg({ ...base, orgId: 'a' }, 'z')).toBe(false)
    expect(canAccessOrg(base, 'z')).toBe(false)
    expect(canAccessOrg({ ...base, orgId: 'a' }, '')).toBe(false)
    expect(canAccessOrg({ ...base, orgId: 'a' }, undefined)).toBe(false)
  })
})
