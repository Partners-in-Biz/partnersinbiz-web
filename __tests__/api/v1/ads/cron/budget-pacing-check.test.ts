// __tests__/api/v1/ads/cron/budget-pacing-check.test.ts
// 4 tests covering the pacing cron route

// ─── Store mock ───────────────────────────────────────────────────────────────
jest.mock('@/lib/ads/budgets/store', () => ({
  computeWindowStart: jest.fn(),
  updateBudgetTracking: jest.fn(),
  appendEvent: jest.fn(),
  resetBudgetForNewPeriod: jest.fn(),
}))

// ─── Pacing mock ─────────────────────────────────────────────────────────────
jest.mock('@/lib/ads/budgets/pacing', () => ({
  sumSpendInScope: jest.fn(),
  computeCheck: jest.fn(),
}))

// ─── Auto-pause mock ─────────────────────────────────────────────────────────
jest.mock('@/lib/ads/budgets/auto-pause', () => ({
  autoPauseCampaignsInScope: jest.fn(),
}))

// ─── Firebase admin mock ─────────────────────────────────────────────────────
const mockCollectionGet = jest.fn()
const mockCollection = jest.fn(() => ({ get: mockCollectionGet }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 9999999, nanoseconds: 0 })),
    fromDate: jest.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d })),
  },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { GET } from '@/app/api/v1/ads/cron/budget-pacing-check/route'

const {
  computeWindowStart,
  updateBudgetTracking,
  appendEvent,
  resetBudgetForNewPeriod,
} = jest.requireMock('@/lib/ads/budgets/store')

const { sumSpendInScope, computeCheck } = jest.requireMock('@/lib/ads/budgets/pacing')
const { autoPauseCampaignsInScope } = jest.requireMock('@/lib/ads/budgets/auto-pause')

// ─── Helpers ─────────────────────────────────────────────────────────────────
const pastTs = {
  seconds: 1_000_000,
  nanoseconds: 0,
  toDate: () => new Date(1_000_000 * 1000),
}

const currentTs = {
  seconds: 1_000_000,
  nanoseconds: 0,
  toDate: () => new Date(1_000_000 * 1000),
}

function makeBudget(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'bgt_cron001',
    orgId: 'org-cron',
    name: 'Cron Budget',
    scope: 'org',
    period: 'monthly',
    capCents: 100_000,
    periodStart: pastTs,
    alertThresholds: [75, 90, 100],
    autoPause: false,
    firedThresholds: [],
    ...overrides,
  }
}

function makeReq(secret?: string): Request {
  const headers: Record<string, string> = {}
  if (secret) headers['authorization'] = `Bearer ${secret}`
  return new Request('http://localhost/api/v1/ads/cron/budget-pacing-check', { headers })
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CRON_SECRET

  const budget = makeBudget()
  mockCollectionGet.mockResolvedValue({
    docs: [{ data: () => budget }],
  })

  computeWindowStart.mockReturnValue(currentTs)
  sumSpendInScope.mockResolvedValue(0)
  computeCheck.mockReturnValue({
    spendCents: 0,
    percent: 0,
    newThresholds: [],
    exhausted: false,
    shouldAutoPause: false,
  })
  updateBudgetTracking.mockResolvedValue(undefined)
  appendEvent.mockResolvedValue({})
  resetBudgetForNewPeriod.mockResolvedValue(undefined)
  autoPauseCampaignsInScope.mockResolvedValue([])
})

// ─── Test 9: Cron iterates all non-archived budgets ───────────────────────────
describe('GET /api/v1/ads/cron/budget-pacing-check', () => {
  it('iterates all non-archived budgets and returns processed count', async () => {
    const b1 = makeBudget({ id: 'bgt_001', orgId: 'org-a' })
    const b2 = makeBudget({ id: 'bgt_002', orgId: 'org-b' })
    // b3 is archived — should be filtered out
    const b3 = makeBudget({ id: 'bgt_003', orgId: 'org-c', archivedAt: pastTs })

    mockCollectionGet.mockResolvedValue({
      docs: [b1, b2, b3].map((b) => ({ data: () => b })),
    })

    const res = await GET(makeReq() as Request)
    expect(res.status).toBe(200)
    const body = await res.json()
    // Only 2 non-archived budgets processed
    expect(body.data.processed).toBe(2)
    expect(body.data.results).toHaveLength(2)
    expect(body.data.results.map((r: { budgetId: string }) => r.budgetId)).toEqual(['bgt_001', 'bgt_002'])
    expect(sumSpendInScope).toHaveBeenCalledTimes(2)
  })

  // ─── Test 10: Detects period rollover and resets ───────────────────────────
  it('detects period rollover and resets the budget', async () => {
    // Make the current window start AFTER the budget's periodStart → rollover
    const futureTs = {
      seconds: 9_999_999,
      nanoseconds: 0,
      toDate: () => new Date(9_999_999 * 1000),
    }
    computeWindowStart.mockReturnValue(futureTs)

    const res = await GET(makeReq() as Request)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.results[0].rollover).toBe(true)
    expect(resetBudgetForNewPeriod).toHaveBeenCalledWith({
      budgetId: 'bgt_cron001',
      newPeriodStart: futureTs,
    })
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ budgetId: 'bgt_cron001', type: 'reset', spendCents: 0, percent: 0 }),
    )
    // sumSpendInScope should NOT have been called for this budget (we reset)
    expect(sumSpendInScope).not.toHaveBeenCalled()
  })

  // ─── Test 11: Continues on per-budget error ────────────────────────────────
  it('continues processing when one budget throws, recording error in results', async () => {
    const b1 = makeBudget({ id: 'bgt_good', orgId: 'org-good' })
    const b2 = makeBudget({ id: 'bgt_bad', orgId: 'org-bad' })

    mockCollectionGet.mockResolvedValue({
      docs: [b1, b2].map((b) => ({ data: () => b })),
    })

    sumSpendInScope
      .mockResolvedValueOnce(10_000) // b1 succeeds
      .mockRejectedValueOnce(new Error('Firestore unavailable')) // b2 throws

    const res = await GET(makeReq() as Request)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.processed).toBe(2)

    const goodResult = body.data.results.find((r: { budgetId: string }) => r.budgetId === 'bgt_good')
    const badResult = body.data.results.find((r: { budgetId: string }) => r.budgetId === 'bgt_bad')
    expect(goodResult.error).toBeUndefined()
    expect(badResult.error).toBe('Firestore unavailable')
  })

  // ─── Test 12: Honors CRON_SECRET header when set ──────────────────────────
  it('returns 401 when CRON_SECRET is set and authorization header is wrong', async () => {
    process.env.CRON_SECRET = 'super-secret-token'

    const resNoAuth = await GET(makeReq() as Request)
    expect(resNoAuth.status).toBe(401)

    const resWrongAuth = await GET(makeReq('wrong-token') as Request)
    expect(resWrongAuth.status).toBe(401)
  })

  it('accepts correct CRON_SECRET Bearer token', async () => {
    process.env.CRON_SECRET = 'correct-token'

    const res = await GET(makeReq('correct-token') as Request)
    expect(res.status).toBe(200)
  })
})
