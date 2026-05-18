// __tests__/api/v1/ads/cron/experiment-significance-check.test.ts
// Sub-5 Batch 2A — 4 tests for significance cron route

import { GET } from '@/app/api/v1/ads/cron/experiment-significance-check/route'

// ── Firebase admin mock ───────────────────────────────────────────────────────
const mockUpdate = jest.fn().mockResolvedValue({})
const mockDocFn = jest.fn(() => ({ update: mockUpdate }))
const mockCollectionFn = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollectionFn(...args),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ seconds: 3000, nanoseconds: 0 }) },
}))

// ── Store mocks ───────────────────────────────────────────────────────────────
const mockAppendResult = jest.fn().mockResolvedValue(undefined)
const mockUpdateExperimentStatus = jest.fn().mockResolvedValue(undefined)

jest.mock('@/lib/ads/experiments/store', () => ({
  appendResult: (...args: unknown[]) => mockAppendResult(...args),
  updateExperimentStatus: (...args: unknown[]) => mockUpdateExperimentStatus(...args),
}))

// ── aggregateAllVariants mock ─────────────────────────────────────────────────
const mockAggregateAllVariants = jest.fn()

jest.mock('@/lib/ads/experiments/results', () => ({
  aggregateAllVariants: (...args: unknown[]) => mockAggregateAllVariants(...args),
}))

// ── computeSignificance mock ──────────────────────────────────────────────────
const mockComputeSignificance = jest.fn()

jest.mock('@/lib/ads/experiments/significance', () => ({
  computeSignificance: (...args: unknown[]) => mockComputeSignificance(...args),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const farPastTimestamp = { seconds: Math.floor(Date.now() / 1000) - 14 * 86400 }  // 14 days ago
const recentTimestamp = { seconds: Math.floor(Date.now() / 1000) - 1 * 86400 }    // 1 day ago

const makeExperiment = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'exp_cron001',
  orgId: 'org-cron',
  name: 'Cron Exp',
  level: 'adset',
  platform: 'meta',
  variants: [
    { id: 'a', name: 'Control', trafficPercent: 50, entityId: 'as_ctrl' },
    { id: 'b', name: 'Variant B', trafficPercent: 50, entityId: 'as_b' },
  ],
  successMetric: 'ctr',
  status: 'running',
  minDays: 7,
  significanceThreshold: 0.05,
  autoWinner: false,
  startedAt: farPastTimestamp,
  createdBy: 'user-1',
  createdAt: { seconds: 1000 },
  updatedAt: { seconds: 1000 },
  ...overrides,
})

const fakeResults = [
  { id: 'r_a', experimentId: 'exp_cron001', variantId: 'a', fromDate: '2026-05-01', toDate: '2026-05-18', impressions: 1000, clicks: 40, conversions: 4, spendCents: 8000, ctr: 0.04, convRate: 0.1, computedAt: { seconds: 3000 } },
  { id: 'r_b', experimentId: 'exp_cron001', variantId: 'b', fromDate: '2026-05-01', toDate: '2026-05-18', impressions: 1000, clicks: 80, conversions: 8, spendCents: 8000, ctr: 0.08, convRate: 0.1, computedAt: { seconds: 3000 } },
]

function makeReq(headers: Record<string, string> = {}) {
  return new Request('http://test.local/api/v1/ads/cron/experiment-significance-check', {
    method: 'GET',
    headers: { ...headers },
  }) as any
}

function setupFirestoreSnap(experiments: ReturnType<typeof makeExperiment>[]) {
  const docsSnap = {
    docs: experiments.map((e) => ({ data: () => e })),
  }
  mockWhere.mockReturnValue({ where: mockWhere, get: mockGet })
  mockGet.mockResolvedValue(docsSnap)
  mockCollectionFn.mockReturnValue({ where: mockWhere, doc: mockDocFn })
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CRON_SECRET
  mockAggregateAllVariants.mockResolvedValue(fakeResults)
  mockComputeSignificance.mockReturnValue({ pValue: 0.03, confident: true, winnerVariantId: 'b' })
})

// ── Test 14: Iterates only running experiments ─────────────────────────────────
describe('GET /api/v1/ads/cron/experiment-significance-check', () => {
  it('iterates only running experiments', async () => {
    setupFirestoreSnap([makeExperiment()])
    const req = makeReq()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.processed).toBe(1)
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'running')
  })

  // ── Test 15: Skips winner declaration when minDays not elapsed ─────────────
  it('skips winner declaration when minDays not elapsed', async () => {
    const recentExp = makeExperiment({ startedAt: recentTimestamp, autoWinner: true })
    setupFirestoreSnap([recentExp])
    const req = makeReq()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const result = body.data.results[0]
    // Should have computed significance but NOT declared winner
    expect(result.skipped).toBe(true)
    expect(result.declared).toBeUndefined()
    // updateExperimentStatus should only be called with 'running' (significance update), not 'winner_declared'
    const winnerCall = mockUpdateExperimentStatus.mock.calls.find((c) => c[1] === 'winner_declared')
    expect(winnerCall).toBeUndefined()
  })

  // ── Test 16: Auto-declares winner when confident + autoWinner ─────────────
  it('auto-declares winner when confident and autoWinner=true', async () => {
    const autoExp = makeExperiment({ autoWinner: true })
    setupFirestoreSnap([autoExp])
    const req = makeReq()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const result = body.data.results[0]
    expect(result.declared).toBe(true)
    expect(result.confident).toBe(true)
    // Should have paused the non-winning entity (variant 'a')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }))
    // Should have flipped to winner_declared
    expect(mockUpdateExperimentStatus).toHaveBeenCalledWith(
      'exp_cron001',
      'winner_declared',
      expect.objectContaining({ declaredWinnerVariantId: 'b' }),
    )
  })

  // ── Test 17: Honors CRON_SECRET header ────────────────────────────────────
  it('returns 401 when CRON_SECRET is set and Authorization header is wrong', async () => {
    process.env.CRON_SECRET = 'super-secret'
    const req = makeReq({ authorization: 'Bearer wrong-secret' })
    const res = await GET(req)
    expect(res.status).toBe(401)
    delete process.env.CRON_SECRET
  })

  it('passes through when CRON_SECRET is set and Authorization header matches', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    setupFirestoreSnap([makeExperiment()])
    const req = makeReq({ authorization: 'Bearer correct-secret' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    delete process.env.CRON_SECRET
  })
})
