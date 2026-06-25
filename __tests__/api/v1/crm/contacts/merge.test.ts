// __tests__/api/v1/crm/contacts/merge.test.ts
// 6 tests for the contact merge endpoint

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(),
    batch: jest.fn(),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__'),
  },
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
      return handler(req, {
        orgId: 'org-a',
        role,
        isAgent: false,
        actor: { uid: 'admin-1', displayName: 'Admin One', kind: 'human' },
        permissions: {},
      }, routeCtx)
    },
}))

jest.mock('@/lib/crm/live-updates', () => ({
  safeTouchCrmLiveUpdate: jest.fn().mockResolvedValue(undefined),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/crm/contacts/merge/route'
import { adminDb } from '@/lib/firebase/admin'

const mockCollection = adminDb.collection as jest.Mock
const mockBatch = adminDb.batch as jest.Mock

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(body: Record<string, unknown>, role = 'admin'): NextRequest {
  const req = new NextRequest('http://localhost/api/v1/crm/contacts/merge', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer test' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return req
}

function makeDocMock(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
  }
}

function makeEmptyQueryMock() {
  return {
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [] }),
  }
}

function makeBatchMock() {
  return {
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
let winnerData: Record<string, unknown>
let loserData: Record<string, unknown>
let updateMock: jest.Mock
let batchInstance: ReturnType<typeof makeBatchMock>

beforeEach(() => {
  jest.clearAllMocks()

  winnerData = { orgId: 'org-a', name: 'Alice', email: 'alice@example.com', tags: ['vip'], stage: 'replied' }
  loserData = { orgId: 'org-a', name: null, email: null, tags: ['hot-lead'], company: 'Acme', stage: 'contacted' }

  updateMock = jest.fn().mockResolvedValue(undefined)
  batchInstance = makeBatchMock()
  mockBatch.mockReturnValue(batchInstance)

  mockCollection.mockImplementation((coll: string) => {
    if (coll === 'contacts') {
      return {
        doc: jest.fn().mockImplementation((id: string) => ({
          get: jest.fn().mockResolvedValue(
            id === 'winner-1' ? makeDocMock(winnerData) : makeDocMock(loserData)
          ),
          update: updateMock,
        })),
      }
    }
    // deals / activities — return empty
    return makeEmptyQueryMock()
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/v1/crm/contacts/merge', () => {
  it('returns 200 and merges contacts, keeping winner fields', async () => {
    const res = await POST(makeReq({ winnerId: 'winner-1', loserId: 'loser-1' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    // Winner name preserved (not null from loser)
    expect(body.data.winner.name).toBe('Alice')
    // Loser's company backfilled (winner had none)
    expect(body.data.winner.company).toBe('Acme')
  })

  it('unions tags from winner and loser', async () => {
    const res = await POST(makeReq({ winnerId: 'winner-1', loserId: 'loser-1' }))
    const body = await res.json()

    const tags: string[] = body.data.winner.tags
    expect(tags).toContain('vip')
    expect(tags).toContain('hot-lead')
  })

  it('soft-deletes loser with mergedIntoId', async () => {
    await POST(makeReq({ winnerId: 'winner-1', loserId: 'loser-1' }))

    // The second update call should be on the loser doc
    const calls = updateMock.mock.calls
    const loserUpdate = calls.find((c: unknown[]) =>
      (c[0] as Record<string, unknown>).deleted === true
    )
    expect(loserUpdate).toBeDefined()
    expect((loserUpdate![0] as Record<string, unknown>).mergedIntoId).toBe('winner-1')
  })

  it('returns 400 when winnerId is missing', async () => {
    const res = await POST(makeReq({ loserId: 'loser-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/winnerId/i)
  })

  it('returns 400 when loserId is missing', async () => {
    const res = await POST(makeReq({ winnerId: 'winner-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/loserId/i)
  })

  it('returns 404 when winner contact not found', async () => {
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(makeDocMock(null)),
            update: updateMock,
          }),
        }
      }
      return makeEmptyQueryMock()
    })

    const res = await POST(makeReq({ winnerId: 'no-such', loserId: 'loser-1' }))
    expect(res.status).toBe(404)
  })
})
