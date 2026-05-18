// __tests__/api/v1/crm/cron/recompute-scores.test.ts
// 6 tests for the nightly recompute-scores cron endpoint (A4 W2-E)

// ─── Mock scoring compute ─────────────────────────────────────────────────────
jest.mock('@/lib/scoring/compute', () => ({
  computeScoresForContact: jest.fn(),
}))

// ─── Mock scoring store ───────────────────────────────────────────────────────
jest.mock('@/lib/scoring/store', () => ({
  getOrBootstrapConfig: jest.fn(),
}))

// ─── Firebase admin mock ──────────────────────────────────────────────────────
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/crm/cron/recompute-scores/route'
import { computeScoresForContact } from '@/lib/scoring/compute'
import { getOrBootstrapConfig } from '@/lib/scoring/store'
import { adminDb } from '@/lib/firebase/admin'

const mockCompute = computeScoresForContact as jest.Mock
const mockGetConfig = getOrBootstrapConfig as jest.Mock
const mockCollection = adminDb.collection as jest.Mock

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/v1/crm/cron/recompute-scores', { headers })
}

function makeOrgDocs(ids: string[]) {
  return ids.map((id) => ({ id, data: () => ({ id, deleted: false }) }))
}

function makeContactDocs(ids: string[]) {
  return ids.map((id) => ({ id, data: () => ({ id, orgId: 'org-a', deleted: false }) }))
}

// Build a Firestore query chain mock that returns the given docs from .get()
function makeQueryMock(docs: ReturnType<typeof makeOrgDocs | typeof makeContactDocs>) {
  const getImpl = jest.fn().mockResolvedValue({ docs })
  return {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: getImpl,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
let orgsQueryMock: ReturnType<typeof makeQueryMock>
let contactsQueryMock: ReturnType<typeof makeQueryMock>

beforeEach(() => {
  jest.clearAllMocks()

  process.env.CRON_SECRET = 'test-secret'

  orgsQueryMock = makeQueryMock(makeOrgDocs(['org-a', 'org-b']))
  contactsQueryMock = makeQueryMock(makeContactDocs(['c1', 'c2', 'c3']))

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return orgsQueryMock
    if (name === 'contacts') return contactsQueryMock
    return {}
  })

  mockGetConfig.mockResolvedValue({ aiEnabled: false })
  mockCompute.mockResolvedValue({ leadScore: 50, icpScore: 40 })
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/v1/crm/cron/recompute-scores', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header is wrong', async () => {
    const res = await GET(makeReq('Bearer wrong-token'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET not configured/i)
  })

  it('processes 2 orgs × 3 contacts and returns correct counts', async () => {
    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.orgsProcessed).toBe(2)
    expect(body.data.contactsProcessed).toBe(6)
    expect(body.data.errors).toHaveLength(0)
    expect(mockCompute).toHaveBeenCalledTimes(6)
  })

  it('continues when a single contact throws and records the error', async () => {
    mockCompute
      .mockResolvedValueOnce({ leadScore: 50, icpScore: 40 }) // org-a/c1 ok
      .mockRejectedValueOnce(new Error('Firestore write failed')) // org-a/c2 fails
      .mockResolvedValue({ leadScore: 50, icpScore: 40 }) // rest ok

    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.contactsProcessed).toBe(5) // 1 failed out of 6
    expect(body.data.errors).toHaveLength(1)
    expect(body.data.errors[0]).toMatch(/Firestore write failed/)
  })

  it('passes aiEnabled=false / true to computeScoresForContact per org config', async () => {
    mockGetConfig
      .mockResolvedValueOnce({ aiEnabled: false }) // org-a
      .mockResolvedValueOnce({ aiEnabled: true })  // org-b

    const singleContactQuery = makeQueryMock(makeContactDocs(['c1']))
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') return orgsQueryMock
      if (name === 'contacts') return singleContactQuery
      return {}
    })

    await GET(makeReq('Bearer test-secret'))

    const calls = mockCompute.mock.calls
    expect(calls[0][2]).toMatchObject({ includeAi: false })
    expect(calls[1][2]).toMatchObject({ includeAi: true })
  })

  it('stops processing additional orgs when time budget is exceeded', async () => {
    orgsQueryMock = makeQueryMock(makeOrgDocs(['org-a', 'org-b', 'org-c']))
    const singleContactQuery = makeQueryMock(makeContactDocs(['c1']))
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') return orgsQueryMock
      if (name === 'contacts') return singleContactQuery
      return {}
    })

    // callCount 1 = startedAt (0), callCount 2 = after org-a finishes (> budget)
    let callCount = 0
    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++
      if (callCount === 1) return 0
      if (callCount === 2) return 56_000
      return Date.now()
    })

    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.orgsProcessed).toBe(1)
    expect(body.data.contactsProcessed).toBe(1)

    jest.spyOn(Date, 'now').mockRestore()
  })
})
