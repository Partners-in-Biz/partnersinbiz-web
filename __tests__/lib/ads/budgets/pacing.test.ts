// __tests__/lib/ads/budgets/pacing.test.ts

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1716000000, nanoseconds: 0, toDate: () => new Date(1716000000 * 1000) })),
    fromDate: jest.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d })),
  },
}))

// Track mock docs for metrics
const metricDocs = new Map<string, Record<string, unknown>>()

jest.mock('@/lib/firebase/admin', () => {
  function makeQuery(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]]),
      get: async () => ({
        docs: Array.from(metricDocs.entries())
          .filter(([k]) => k.startsWith(`${path}/`))
          .filter(([, data]) =>
            filters.every(([field, , value]) =>
              (data as Record<string, unknown>)[field] === value,
            ),
          )
          .map(([, v]) => ({ data: () => v })),
      }),
    }
  }

  return {
    adminDb: {
      collection: (name: string) => ({
        where: (field: string, op: string, value: unknown) =>
          makeQuery(name, [[field, op, value]]),
      }),
    },
  }
})

// ─── Subject ─────────────────────────────────────────────────────────────────

import { sumSpendInScope, computeCheck } from '@/lib/ads/budgets/pacing'
import type { AdBudget } from '@/lib/ads/budgets/types'
import { Timestamp } from 'firebase-admin/firestore'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fakeTimestamp(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d }
}

function seedMetric(id: string, data: Record<string, unknown>) {
  metricDocs.set(`metrics/${id}`, data)
}

function baseBudget(overrides: Partial<AdBudget> = {}): AdBudget {
  const now = { seconds: 1716000000, nanoseconds: 0, toDate: () => new Date(1716000000 * 1000) } as unknown as ReturnType<typeof Timestamp.now>
  return {
    id: 'bgt_test',
    orgId: 'org_1',
    scope: 'org',
    capCents: 100000,
    currencyCode: 'USD',
    period: 'monthly',
    periodStart: now,
    alertThresholds: [75, 90, 100],
    autoPause: false,
    name: 'Test Budget',
    createdBy: 'user_a',
    createdAt: now,
    updatedAt: now,
    firedThresholds: [],
    ...overrides,
  } as AdBudget
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  metricDocs.clear()
})

describe('sumSpendInScope', () => {
  it('org scope: sums spend across all platforms for the org', async () => {
    const windowStart = fakeTimestamp('2024-05-01')
    seedMetric('m1', { orgId: 'org_1', metric: 'spend_cents', source: 'meta_ads', date: '2024-05-10', value: 30000 })
    seedMetric('m2', { orgId: 'org_1', metric: 'spend_cents', source: 'google_ads', date: '2024-05-12', value: 20000 })
    seedMetric('m3', { orgId: 'org_2', metric: 'spend_cents', source: 'meta_ads', date: '2024-05-10', value: 99999 })  // different org

    const budget = baseBudget({ scope: 'org' })
    const total = await sumSpendInScope(budget, windowStart as unknown as ReturnType<typeof Timestamp.now>)
    expect(total).toBe(50000)
  })

  it('platform scope: filters by source = {platform}_ads', async () => {
    const windowStart = fakeTimestamp('2024-05-01')
    seedMetric('m1', { orgId: 'org_1', metric: 'spend_cents', source: 'meta_ads', date: '2024-05-10', value: 30000 })
    seedMetric('m2', { orgId: 'org_1', metric: 'spend_cents', source: 'google_ads', date: '2024-05-12', value: 20000 })

    const budget = baseBudget({ scope: 'platform', platform: 'meta' })
    const total = await sumSpendInScope(budget, windowStart as unknown as ReturnType<typeof Timestamp.now>)
    expect(total).toBe(30000)
  })

  it('campaign scope: filters by level=campaign + dimensionId=campaignId', async () => {
    const windowStart = fakeTimestamp('2024-05-01')
    seedMetric('m1', { orgId: 'org_1', metric: 'spend_cents', source: 'meta_ads', level: 'campaign', dimensionId: 'cmp_abc', date: '2024-05-10', value: 12000 })
    seedMetric('m2', { orgId: 'org_1', metric: 'spend_cents', source: 'meta_ads', level: 'campaign', dimensionId: 'cmp_xyz', date: '2024-05-10', value: 8000 })

    const budget = baseBudget({ scope: 'campaign', platform: 'meta', campaignId: 'cmp_abc' })
    const total = await sumSpendInScope(budget, windowStart as unknown as ReturnType<typeof Timestamp.now>)
    expect(total).toBe(12000)
  })

  it('filters out rows with date before windowStart', async () => {
    const windowStart = fakeTimestamp('2024-05-01')
    seedMetric('m1', { orgId: 'org_1', metric: 'spend_cents', source: 'meta_ads', date: '2024-04-30', value: 99000 })  // before window
    seedMetric('m2', { orgId: 'org_1', metric: 'spend_cents', source: 'meta_ads', date: '2024-05-01', value: 5000 })   // on window start — included

    const budget = baseBudget({ scope: 'org' })
    const total = await sumSpendInScope(budget, windowStart as unknown as ReturnType<typeof Timestamp.now>)
    expect(total).toBe(5000)
  })
})

describe('computeCheck', () => {
  it('computes percent correctly (75000 / 100000 = 75%)', () => {
    const budget = baseBudget({ capCents: 100000 })
    const result = computeCheck(budget, 75000)
    expect(result.percent).toBe(75)
    expect(result.spendCents).toBe(75000)
    expect(result.exhausted).toBe(false)
  })

  it('capCents=0 returns 0% (division guard)', () => {
    const budget = baseBudget({ capCents: 0 })
    const result = computeCheck(budget, 5000)
    expect(result.percent).toBe(0)
    expect(result.exhausted).toBe(false)
  })

  it('newThresholds excludes already-fired thresholds', () => {
    const budget = baseBudget({
      capCents: 100000,
      alertThresholds: [75, 90, 100],
      firedThresholds: [75],  // 75 already fired
    })
    const result = computeCheck(budget, 91000)  // 91% — crosses 75 + 90
    expect(result.newThresholds).toEqual([90])  // 75 excluded, 100 not crossed
  })

  it('newThresholds includes all newly crossed thresholds', () => {
    const budget = baseBudget({
      capCents: 100000,
      alertThresholds: [75, 90, 100],
      firedThresholds: [],
    })
    const result = computeCheck(budget, 100000)  // 100% — crosses all
    expect(result.newThresholds).toEqual([75, 90, 100])
    expect(result.exhausted).toBe(true)
  })

  it('exhausted=true when percent >= 100', () => {
    const budget = baseBudget({ capCents: 100000 })
    const result = computeCheck(budget, 110000)
    expect(result.exhausted).toBe(true)
    expect(result.percent).toBeCloseTo(110, 5)
  })

  it('shouldAutoPause=true only when autoPause=true + exhausted + not already paused', () => {
    const budget = baseBudget({ capCents: 100000, autoPause: true, pausedCampaignIds: [] })
    const result = computeCheck(budget, 100000)
    expect(result.shouldAutoPause).toBe(true)
  })

  it('shouldAutoPause=false when autoPause=false', () => {
    const budget = baseBudget({ capCents: 100000, autoPause: false })
    const result = computeCheck(budget, 100000)
    expect(result.shouldAutoPause).toBe(false)
  })

  it('shouldAutoPause=false when campaigns already paused', () => {
    const budget = baseBudget({
      capCents: 100000,
      autoPause: true,
      pausedCampaignIds: ['cmp_abc'],  // already paused
    })
    const result = computeCheck(budget, 100000)
    expect(result.shouldAutoPause).toBe(false)
  })
})
