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
// We'll set up the chainable query mock per-test via mockImplementation.
const mockLimit = jest.fn()
const mockOrderBy = jest.fn(() => ({ limit: mockLimit }))
const mockOrderBy1 = jest.fn(() => ({ orderBy: mockOrderBy }))
const mockWhereContacts2 = jest.fn(() => ({ orderBy: mockOrderBy1 }))
const mockWhereContacts1 = jest.fn(() => ({ where: mockWhereContacts2 }))

const mockOrgsGet = jest.fn()
const mockOrgsWhere = jest.fn(() => ({ get: mockOrgsGet }))

const mockCollection = jest.fn((name: string) => {
  if (name === 'organizations') return { where: mockOrgsWhere }
  if (name === 'contacts') return { where: mockWhereContacts1 }
  return {}
})

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { GET } from '@/app/api/v1/crm/cron/recompute-scores/route'
import { computeScoresForContact } from '@/lib/scoring/compute'
import { getOrBootstrapConfig } from '@/lib/scoring/store'

const mockCompute = computeScoresForContact as jest.Mock
const mockGetConfig = getOrBootstrapConfig as jest.Mock

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(authHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new Request('http://localhost/api/v1/crm/cron/recompute-scores', { headers })
}

function makeOrgDocs(ids: string[]) {
  return ids.map((id) => ({ id, data: () => ({ id, deleted: false }) }))
}

function makeContactDocs(ids: string[]) {
  return ids.map((id) => ({ id, data: () => ({ id, orgId: 'org-a', deleted: false }) }))
}

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()

  // Default: CRON_SECRET set
  process.env.CRON_SECRET = 'test-secret'

  // Default orgs: 2 orgs
  mockOrgsGet.mockResolvedValue({ docs: makeOrgDocs(['org-a', 'org-b']) })

  // Default contacts: 3 per org
  mockLimit.mockResolvedValue({ docs: makeContactDocs(['c1', 'c2', 'c3']) })

  // Default config: aiEnabled false
  mockGetConfig.mockResolvedValue({ aiEnabled: false })

  // Default compute: returns a score update
  mockCompute.mockResolvedValue({ leadScore: 50, icpScore: 40 })
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/v1/crm/cron/recompute-scores', () => {
  // Test 1: 401 when CRON_SECRET missing or wrong
  it('returns 401 when authorization header is missing', async () => {
    const res = await GET(makeReq() as Request)
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header is wrong', async () => {
    const res = await GET(makeReq('Bearer wrong-token') as Request)
    expect(res.status).toBe(401)
  })

  // Test 2: 500 when CRON_SECRET not configured
  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET

    const res = await GET(makeReq('Bearer anything') as Request)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET not configured/i)
  })

  // Test 3: Happy path — 2 orgs, 3 contacts each
  it('processes 2 orgs × 3 contacts and returns correct counts', async () => {
    const res = await GET(makeReq('Bearer test-secret') as Request)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.orgsProcessed).toBe(2)
    expect(body.data.contactsProcessed).toBe(6)
    expect(body.data.errors).toHaveLength(0)

    // computeScoresForContact called 6 times total
    expect(mockCompute).toHaveBeenCalledTimes(6)
  })

  // Test 4: Per-contact failure does NOT break the whole run
  it('continues when a single contact throws and records the error', async () => {
    mockCompute
      .mockResolvedValueOnce({ leadScore: 50, icpScore: 40 }) // org-a/c1 ok
      .mockRejectedValueOnce(new Error('Firestore write failed')) // org-a/c2 fails
      .mockResolvedValue({ leadScore: 50, icpScore: 40 }) // rest ok

    const res = await GET(makeReq('Bearer test-secret') as Request)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.contactsProcessed).toBe(5) // 1 failed out of 6
    expect(body.data.errors).toHaveLength(1)
    expect(body.data.errors[0]).toMatch(/Firestore write failed/)
  })

  // Test 5: Per-org config respected — aiEnabled propagated correctly
  it('passes aiEnabled=false / true to computeScoresForContact per org config', async () => {
    // org-a: aiEnabled false, org-b: aiEnabled true
    mockGetConfig
      .mockResolvedValueOnce({ aiEnabled: false }) // org-a
      .mockResolvedValueOnce({ aiEnabled: true })  // org-b

    // 1 contact per org for simplicity
    mockLimit.mockResolvedValue({ docs: makeContactDocs(['c1']) })

    await GET(makeReq('Bearer test-secret') as Request)

    const calls = mockCompute.mock.calls
    // org-a call → includeAi false
    expect(calls[0][2]).toMatchObject({ includeAi: false })
    // org-b call → includeAi true
    expect(calls[1][2]).toMatchObject({ includeAi: true })
  })

  // Test 6: Time budget cutoff — additional orgs skipped once elapsed > 55 s
  it('stops processing additional orgs when time budget is exceeded', async () => {
    // Arrange 3 orgs
    mockOrgsGet.mockResolvedValue({ docs: makeOrgDocs(['org-a', 'org-b', 'org-c']) })
    mockLimit.mockResolvedValue({ docs: makeContactDocs(['c1']) })

    // Mock Date.now: first call is startedAt, second call (inside loop for org-b) returns >55 s
    const realDateNow = Date.now.bind(Date)
    let callCount = 0
    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++
      if (callCount === 1) return 0        // startedAt
      if (callCount === 2) return 56_000   // checked before org-b → over budget
      return realDateNow()
    })

    const res = await GET(makeReq('Bearer test-secret') as Request)
    expect(res.status).toBe(200)

    const body = await res.json()
    // Only org-a was processed before time budget was exceeded
    expect(body.data.orgsProcessed).toBe(1)
    expect(body.data.contactsProcessed).toBe(1)

    jest.spyOn(Date, 'now').mockRestore()
  })
})
