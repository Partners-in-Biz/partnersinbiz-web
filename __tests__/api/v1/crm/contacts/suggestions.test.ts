// __tests__/api/v1/crm/contacts/suggestions.test.ts
// 6 tests for the rule-based contact suggestions endpoint

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

// withCrmAuth: pass through as member
jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_role: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) =>
      handler(req, { orgId: 'org-a', role: 'member', isAgent: false, permissions: {} }, routeCtx),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/crm/contacts/[id]/suggestions/route'
import { adminDb } from '@/lib/firebase/admin'

const mockCollection = adminDb.collection as jest.Mock

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(contactId = 'contact-1'): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/crm/contacts/${contactId}/suggestions`,
    { headers: { 'authorization': 'Bearer test' } }
  )
}

function makeRouteCtx(id = 'contact-1') {
  return { params: Promise.resolve({ id }) }
}

function msAgo(days: number): number {
  return Date.now() - days * 86_400_000
}

function makeTimestamp(ms: number) {
  return {
    toMillis: () => ms,
  }
}

function makeContactMock(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
  }
}

function makeActivitiesQueryMock(activities: Array<Record<string, unknown>>) {
  return {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      empty: activities.length === 0,
      docs: activities.map((a, i) => ({ id: `act-${i}`, data: () => a })),
    }),
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/v1/crm/contacts/[id]/suggestions', () => {
  it('returns high-urgency follow-up when 7+ days no activity and stage=contacted', async () => {
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(
              makeContactMock({ orgId: 'org-a', stage: 'contacted', leadScore: 60 })
            ),
          }),
        }
      }
      return makeActivitiesQueryMock([
        { contactId: 'contact-1', createdAt: makeTimestamp(msAgo(10)) },
      ])
    })

    const res = await GET(makeReq(), makeRouteCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    const followUp = body.data.suggestions.find((s: { action: string }) =>
      s.action === 'Send a follow-up'
    )
    expect(followUp).toBeDefined()
    expect(followUp.urgency).toBe('high')
  })

  it('returns qualify suggestion when leadScore < 30', async () => {
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(
              makeContactMock({ orgId: 'org-a', stage: 'new', leadScore: 20 })
            ),
          }),
        }
      }
      return makeActivitiesQueryMock([])
    })

    const res = await GET(makeReq(), makeRouteCtx())
    const body = await res.json()
    const qualify = body.data.suggestions.find((s: { action: string }) =>
      s.action === 'Qualify or archive'
    )
    expect(qualify).toBeDefined()
    expect(qualify.urgency).toBe('medium')
  })

  it('returns empty suggestions for active engaged contact', async () => {
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(
              makeContactMock({ orgId: 'org-a', stage: 'won', leadScore: 85 })
            ),
          }),
        }
      }
      return makeActivitiesQueryMock([
        { contactId: 'contact-1', createdAt: makeTimestamp(msAgo(1)) },
      ])
    })

    const res = await GET(makeReq(), makeRouteCtx())
    const body = await res.json()
    expect(body.data.suggestions).toHaveLength(0)
  })

  it('returns 404 when contact does not exist', async () => {
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(makeContactMock(null)),
          }),
        }
      }
      return makeActivitiesQueryMock([])
    })

    const res = await GET(makeReq('no-such'), makeRouteCtx('no-such'))
    expect(res.status).toBe(404)
  })

  it('returns move-to-demo suggestion for high score + replied stage', async () => {
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(
              makeContactMock({ orgId: 'org-a', stage: 'replied', leadScore: 80 })
            ),
          }),
        }
      }
      return makeActivitiesQueryMock([
        { contactId: 'contact-1', createdAt: makeTimestamp(msAgo(1)) },
      ])
    })

    const res = await GET(makeReq(), makeRouteCtx())
    const body = await res.json()
    const demo = body.data.suggestions.find((s: { action: string }) =>
      s.action === 'Move to demo'
    )
    expect(demo).toBeDefined()
    expect(demo.urgency).toBe('medium')
  })

  it('member role is allowed (200 response)', async () => {
    // withCrmAuth mock always passes member role through
    mockCollection.mockImplementation((coll: string) => {
      if (coll === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(
              makeContactMock({ orgId: 'org-a', stage: 'new', leadScore: 55 })
            ),
          }),
        }
      }
      return makeActivitiesQueryMock([])
    })

    const res = await GET(makeReq(), makeRouteCtx())
    expect(res.status).toBe(200)
  })
})
