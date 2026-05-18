// __tests__/lib/ads/experiments/results.test.ts

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTimestampNow = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: (...args: unknown[]) => mockTimestampNow(...args),
  },
}))

// Metrics store — keyed by "orgId|source|level|dimensionId|metric|date"
const metricsStore = new Map<string, { orgId: string; source: string; level: string; dimensionId: string; metric: string; date: string; value: number }>()

jest.mock('@/lib/firebase/admin', () => {
  function makeQuery(filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery([...filters, [field, op, value]]),
      get: async () => ({
        docs: Array.from(metricsStore.values())
          .filter((row) =>
            filters.every(([field, , value]) => (row as Record<string, unknown>)[field] === value),
          )
          .map((row) => ({ data: () => row })),
      }),
    }
  }

  function makeCollection(name: string) {
    if (name === 'metrics') {
      return {
        where: (field: string, op: string, value: unknown) => makeQuery([[field, op, value]]),
      }
    }
    return { doc: () => ({}) }
  }

  return {
    adminDb: { collection: (name: string) => makeCollection(name) },
  }
})

// ─── Subject ─────────────────────────────────────────────────────────────────

import { aggregateVariantResult, aggregateAllVariants } from '@/lib/ads/experiments/results'
import type { AdExperiment } from '@/lib/ads/experiments/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeTimestamp(seconds = 1716000000) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) }
}

function makeExperiment(overrides?: Partial<AdExperiment>): AdExperiment {
  return {
    id: 'exp_001',
    orgId: 'org_1',
    name: 'Test Experiment',
    level: 'adset',
    parentEntityId: 'campaign_1',
    sourceEntityId: 'as_source',
    platform: 'meta',
    variants: [
      { id: 'a', name: 'Control', trafficPercent: 50, entityId: 'as_001' },
      { id: 'b', name: 'Variant B', trafficPercent: 50, entityId: 'as_002' },
    ],
    successMetric: 'ctr',
    status: 'running',
    minDays: 7,
    significanceThreshold: 0.05,
    autoWinner: false,
    createdBy: 'user_1',
    createdAt: makeFakeTimestamp() as ReturnType<typeof makeFakeTimestamp>,
    updatedAt: makeFakeTimestamp() as ReturnType<typeof makeFakeTimestamp>,
    ...overrides,
  } as AdExperiment
}

function seedMetric(args: {
  orgId: string
  platform: string
  dimensionId: string
  level: string
  metric: string
  date: string
  value: number
}) {
  const key = `${args.orgId}|${args.platform}_ads|${args.level}|${args.dimensionId}|${args.metric}|${args.date}`
  metricsStore.set(key, {
    orgId: args.orgId,
    source: `${args.platform}_ads`,
    level: args.level,
    dimensionId: args.dimensionId,
    metric: args.metric,
    date: args.date,
    value: args.value,
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  metricsStore.clear()
  mockTimestampNow.mockReturnValue(makeFakeTimestamp())
})

// Test 19 (scope numbering from spec)
it('aggregateVariantResult: throws when variant missing entityId', async () => {
  const exp = makeExperiment({
    variants: [
      { id: 'a', name: 'Control', trafficPercent: 50 },  // no entityId
      { id: 'b', name: 'B', trafficPercent: 50, entityId: 'as_002' },
    ],
  })

  await expect(
    aggregateVariantResult({ experiment: exp, variantId: 'a', fromDate: '2024-01-01', toDate: '2024-01-07' }),
  ).rejects.toThrow('no entityId')
})

// Test 20
it('aggregateVariantResult: queries metrics by source=platform_ads + level + dimensionId', async () => {
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'impressions', date: '2024-01-03', value: 1000 })
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'clicks', date: '2024-01-03', value: 50 })
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'conversions', date: '2024-01-03', value: 5 })
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'spend_cents', date: '2024-01-03', value: 10000 })

  const exp = makeExperiment()
  const result = await aggregateVariantResult({ experiment: exp, variantId: 'a', fromDate: '2024-01-01', toDate: '2024-01-07' })

  expect(result.impressions).toBe(1000)
  expect(result.clicks).toBe(50)
  expect(result.conversions).toBe(5)
  expect(result.spendCents).toBe(10000)
})

// Test 21
it('aggregateVariantResult: filters by fromDate/toDate', async () => {
  // Inside range
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'impressions', date: '2024-01-03', value: 500 })
  // Before range — should be excluded
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'impressions', date: '2023-12-31', value: 999 })
  // After range — should be excluded
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'impressions', date: '2024-01-08', value: 888 })

  const exp = makeExperiment()
  const result = await aggregateVariantResult({ experiment: exp, variantId: 'a', fromDate: '2024-01-01', toDate: '2024-01-07' })

  expect(result.impressions).toBe(500)
})

// Test 22
it('aggregateVariantResult: derives ctr/cpc/cpa/convRate correctly', async () => {
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'impressions', date: '2024-01-03', value: 2000 })
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'clicks', date: '2024-01-03', value: 100 })
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'conversions', date: '2024-01-03', value: 10 })
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'spend_cents', date: '2024-01-03', value: 20000 })

  const exp = makeExperiment()
  const result = await aggregateVariantResult({ experiment: exp, variantId: 'a', fromDate: '2024-01-01', toDate: '2024-01-07' })

  expect(result.ctr).toBeCloseTo(100 / 2000, 6)
  expect(result.cpc).toBeCloseTo(20000 / 100, 2)
  expect(result.cpa).toBeCloseTo(20000 / 10, 2)
  expect(result.convRate).toBeCloseTo(10 / 100, 6)
})

// Test 23
it('aggregateVariantResult: handles zero clicks → ctr=0, convRate=0, cpc=undefined', async () => {
  seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: 'as_001', level: 'adset', metric: 'impressions', date: '2024-01-03', value: 1000 })
  // No clicks, conversions, or spend seeded

  const exp = makeExperiment()
  const result = await aggregateVariantResult({ experiment: exp, variantId: 'a', fromDate: '2024-01-01', toDate: '2024-01-07' })

  expect(result.clicks).toBe(0)
  expect(result.ctr).toBe(0)
  expect(result.convRate).toBe(0)
  expect(result.cpc).toBeUndefined()
  expect(result.cpa).toBeUndefined()
})

// Test 24
it('aggregateAllVariants: processes all variants in the experiment', async () => {
  // Seed metrics for both variant entities
  for (const entityId of ['as_001', 'as_002']) {
    seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: entityId, level: 'adset', metric: 'impressions', date: '2024-01-03', value: entityId === 'as_001' ? 1000 : 2000 })
    seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: entityId, level: 'adset', metric: 'clicks', date: '2024-01-03', value: entityId === 'as_001' ? 50 : 100 })
    seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: entityId, level: 'adset', metric: 'conversions', date: '2024-01-03', value: 0 })
    seedMetric({ orgId: 'org_1', platform: 'meta', dimensionId: entityId, level: 'adset', metric: 'spend_cents', date: '2024-01-03', value: 0 })
  }

  const exp = makeExperiment()
  const results = await aggregateAllVariants({ experiment: exp, fromDate: '2024-01-01', toDate: '2024-01-07' })

  expect(results).toHaveLength(2)
  const aResult = results.find((r) => r.variantId === 'a')!
  const bResult = results.find((r) => r.variantId === 'b')!
  expect(aResult.impressions).toBe(1000)
  expect(bResult.impressions).toBe(2000)
})
