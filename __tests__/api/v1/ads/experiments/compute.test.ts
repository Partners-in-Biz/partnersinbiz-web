// __tests__/api/v1/ads/experiments/compute.test.ts
// Sub-5 Batch 2A — 3 tests for /compute route

import { POST as computePOST } from '@/app/api/v1/ads/experiments/[id]/compute/route'

// ── Auth bypass ───────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ── Firebase admin mock ───────────────────────────────────────────────────────
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ seconds: 2000, nanoseconds: 0 }) },
}))

// ── Store mocks ───────────────────────────────────────────────────────────────
const mockGetExperiment = jest.fn()
const mockAppendResult = jest.fn().mockResolvedValue(undefined)
const mockUpdateExperimentStatus = jest.fn().mockResolvedValue(undefined)

jest.mock('@/lib/ads/experiments/store', () => ({
  getExperiment: (...args: unknown[]) => mockGetExperiment(...args),
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
const ORG = 'org-compute'
const EXP_ID = 'exp_compute001'

const fakeExperiment = {
  id: EXP_ID,
  orgId: ORG,
  name: 'Compute Experiment',
  level: 'adset',
  platform: 'meta',
  variants: [
    { id: 'a', name: 'Control', trafficPercent: 50, entityId: 'as_control' },
    { id: 'b', name: 'Variant B', trafficPercent: 50, entityId: 'as_variantb' },
  ],
  successMetric: 'ctr',
  status: 'running',
  minDays: 7,
  significanceThreshold: 0.05,
  autoWinner: false,
  startedAt: { seconds: 1000 },
  createdBy: 'user-1',
  createdAt: { seconds: 900 },
  updatedAt: { seconds: 900 },
}

const fakeResults = [
  { id: 'r_a', experimentId: EXP_ID, variantId: 'a', fromDate: '2026-05-01', toDate: '2026-05-18', impressions: 1000, clicks: 50, conversions: 5, spendCents: 10000, ctr: 0.05, convRate: 0.1, computedAt: { seconds: 2000 } },
  { id: 'r_b', experimentId: EXP_ID, variantId: 'b', fromDate: '2026-05-01', toDate: '2026-05-18', impressions: 1000, clicks: 80, conversions: 8, spendCents: 10000, ctr: 0.08, convRate: 0.1, computedAt: { seconds: 2000 } },
]

const fakeSignificance = { pValue: 0.03, confident: true, winnerVariantId: 'b' }

function makeReq(body?: object) {
  return new Request(`http://test.local/api/v1/ads/experiments/${EXP_ID}/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': ORG },
    body: body ? JSON.stringify(body) : undefined,
  }) as any
}

function makeCtx(id: string = EXP_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetExperiment.mockResolvedValue(fakeExperiment)
  mockAggregateAllVariants.mockResolvedValue(fakeResults)
  mockComputeSignificance.mockReturnValue(fakeSignificance)
})

// ── Test 11: /compute calls aggregateAllVariants + computeSignificance + appendResult ──
describe('POST /api/v1/ads/experiments/[id]/compute', () => {
  it('calls aggregateAllVariants, computeSignificance, and appendResult per variant', async () => {
    const req = makeReq()
    const res = await computePOST(req, undefined, makeCtx())
    expect(res.status).toBe(200)

    expect(mockAggregateAllVariants).toHaveBeenCalledWith(expect.objectContaining({ experiment: fakeExperiment }))
    expect(mockComputeSignificance).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ metric: 'ctr' }),
      threshold: 0.05,
    }))
    // One appendResult per variant
    expect(mockAppendResult).toHaveBeenCalledTimes(2)
    expect(mockAppendResult).toHaveBeenCalledWith(expect.objectContaining({ experimentId: EXP_ID, result: fakeResults[0] }))
    expect(mockAppendResult).toHaveBeenCalledWith(expect.objectContaining({ experimentId: EXP_ID, result: fakeResults[1] }))
  })

  // ── Test 12: Persists significance on experiment ──────────────────────────
  it('persists significance on the experiment', async () => {
    const req = makeReq()
    await computePOST(req, undefined, makeCtx())

    expect(mockUpdateExperimentStatus).toHaveBeenCalledWith(
      EXP_ID,
      'running',
      expect.objectContaining({
        significance: expect.objectContaining({
          pValue: 0.03,
          confident: true,
          winnerVariantId: 'b',
        }),
      }),
    )
  })

  // ── Test 13: Returns { results, significance } ────────────────────────────
  it('returns { results, significance }', async () => {
    const req = makeReq()
    const res = await computePOST(req, undefined, makeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.results).toHaveLength(2)
    expect(body.data.significance.pValue).toBe(0.03)
    expect(body.data.significance.confident).toBe(true)
    expect(body.data.significance.winnerVariantId).toBe('b')
  })
})
