// __tests__/api/v1/crm/contacts/duplicates.test.ts
// 6 tests for duplicate detection endpoint

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

// withCrmAuth: gate by role
jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (minRole: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) => {
      const role = (req as Request & { _testRole?: string })._testRole ?? minRole
      if (minRole === 'admin' && role === 'member') {
        const { NextResponse } = require('next/server')
        return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
      }
      return handler(req, { orgId: 'org-a', role, isAgent: false, permissions: {} }, routeCtx)
    },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/crm/contacts/duplicates/route'
import { adminDb } from '@/lib/firebase/admin'

const mockCollection = adminDb.collection as jest.Mock

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(role = 'admin'): NextRequest {
  const req = new NextRequest('http://localhost/api/v1/crm/contacts/duplicates', {
    headers: { 'authorization': 'Bearer test' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return req
}

function makeQueryMock(contacts: Array<Record<string, unknown>>) {
  return {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: contacts.map((c) => ({ id: c.id as string, data: () => c })),
    }),
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/v1/crm/contacts/duplicates', () => {
  it('returns 200 with email-grouped duplicates', async () => {
    mockCollection.mockReturnValue(makeQueryMock([
      { id: 'c1', orgId: 'org-a', email: 'alice@example.com', name: 'Alice' },
      { id: 'c2', orgId: 'org-a', email: 'alice@example.com', name: 'Alice Duplicate' },
      { id: 'c3', orgId: 'org-a', email: 'unique@example.com', name: 'Bob' },
    ]))

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.groups).toHaveLength(1)
    expect(body.data.groups[0].reason).toBe('email')
    expect(body.data.groups[0].contacts).toHaveLength(2)
  })

  it('groups by name when email is absent', async () => {
    mockCollection.mockReturnValue(makeQueryMock([
      { id: 'c1', orgId: 'org-a', name: 'Bob Smith' },
      { id: 'c2', orgId: 'org-a', name: 'Bob Smith' },
      { id: 'c3', orgId: 'org-a', name: 'Carol' },
    ]))

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.data.groups).toHaveLength(1)
    expect(body.data.groups[0].reason).toBe('name')
    expect(body.data.groups[0].contacts).toHaveLength(2)
  })

  it('is case-insensitive for email matching', async () => {
    mockCollection.mockReturnValue(makeQueryMock([
      { id: 'c1', orgId: 'org-a', email: 'Alice@Example.COM', name: 'Alice' },
      { id: 'c2', orgId: 'org-a', email: 'alice@example.com', name: 'Alice 2' },
    ]))

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.data.groups).toHaveLength(1)
    expect(body.data.groups[0].reason).toBe('email')
  })

  it('only returns groups with 2+ contacts', async () => {
    mockCollection.mockReturnValue(makeQueryMock([
      { id: 'c1', orgId: 'org-a', email: 'alice@example.com', name: 'Alice' },
      { id: 'c2', orgId: 'org-a', email: 'bob@example.com', name: 'Bob' },
    ]))

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.data.groups).toHaveLength(0)
  })

  it('returns 403 for member role', async () => {
    const res = await GET(makeReq('member'))
    expect(res.status).toBe(403)
  })

  it('returns empty groups when no contacts', async () => {
    mockCollection.mockReturnValue(makeQueryMock([]))

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.data.groups).toHaveLength(0)
  })
})
