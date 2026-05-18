// __tests__/lib/ads/experiments/store.test.ts

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTimestampNow = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: (...args: unknown[]) => mockTimestampNow(...args),
  },
}))

jest.mock('@/lib/firebase/admin', () => {
  const docs = new Map<string, Record<string, unknown>>()

  function makeQuery(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]]),
      orderBy: (_field: string, _dir?: string) => makeQuery(path, filters),
      limit: (_n: number) => makeQuery(path, filters),
      get: async () => ({
        docs: Array.from(docs.entries())
          .filter(([k]) => k.startsWith(`${path}/`) && k.split('/').length === path.split('/').length + 1)
          .filter(([, data]) =>
            filters.every(([field, , value]) => {
              return (data as Record<string, unknown>)[field] === value
            }),
          )
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })),
      }),
    }
  }

  function makeDoc(fullPath: string) {
    return {
      get: async () => ({
        exists: docs.has(fullPath),
        id: fullPath.split('/').pop(),
        data: () => docs.get(fullPath),
      }),
      set: async (data: Record<string, unknown>) => {
        docs.set(fullPath, { ...data })
      },
      update: async (patch: Record<string, unknown>) => {
        const cur = docs.get(fullPath) ?? {}
        docs.set(fullPath, { ...cur, ...patch })
      },
      delete: async () => {
        docs.delete(fullPath)
      },
      collection: (subName: string) => makeCollection(`${fullPath}/${subName}`),
    }
  }

  function makeCollection(path: string) {
    return {
      doc: (id: string) => makeDoc(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => makeQuery(path, [[field, op, value]]),
      orderBy: (_field: string, _dir?: string) => makeQuery(path, []),
    }
  }

  return {
    adminDb: { collection: (name: string) => makeCollection(name) },
    _docs: docs,
  }
})

let cryptoCounter = 0
jest.mock('crypto', () => ({
  randomBytes: (n: number) => {
    const val = String(cryptoCounter++).padStart(n * 2, '0')
    return { toString: () => val.slice(0, n * 2) }
  },
}))

// ─── Subject ─────────────────────────────────────────────────────────────────

import {
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  archiveExperiment,
  updateExperimentStatus,
  appendResult,
  listResults,
} from '@/lib/ads/experiments/store'
import type { AdExperimentResult } from '@/lib/ads/experiments/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeTimestamp(seconds = 1716000000) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) }
}

function baseVariants() {
  return [
    { id: 'a', name: 'Control', trafficPercent: 50 },
    { id: 'b', name: 'Variant B', trafficPercent: 50 },
  ]
}

function baseInput() {
  return {
    name: 'Test experiment',
    level: 'adset' as const,
    parentEntityId: 'campaign_1',
    sourceEntityId: 'adset_1',
    platform: 'meta' as const,
    variants: baseVariants(),
    successMetric: 'ctr' as const,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
  _docs.clear()
  cryptoCounter = 0
  mockTimestampNow.mockReturnValue(makeFakeTimestamp())
})

// Test 1
it('createExperiment: validates variants sum to 100%', async () => {
  await expect(
    createExperiment({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: {
        ...baseInput(),
        variants: [
          { id: 'a', name: 'Control', trafficPercent: 40 },
          { id: 'b', name: 'B', trafficPercent: 40 },
        ],
      },
    }),
  ).rejects.toThrow('sum to 100')
})

// Test 2
it('createExperiment: throws on fewer than 2 variants', async () => {
  await expect(
    createExperiment({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: {
        ...baseInput(),
        variants: [{ id: 'a', name: 'Control', trafficPercent: 100 }],
      },
    }),
  ).rejects.toThrow('at least 2 variants')
})

// Test 3
it('createExperiment: throws on duplicate variant ids', async () => {
  await expect(
    createExperiment({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: {
        ...baseInput(),
        variants: [
          { id: 'a', name: 'Control', trafficPercent: 50 },
          { id: 'a', name: 'Duplicate', trafficPercent: 50 },
        ],
      },
    }),
  ).rejects.toThrow('unique')
})

// Test 4
it('createExperiment: applies defaults — minDays=7, significanceThreshold=0.05, autoWinner=false', async () => {
  const result = await createExperiment({
    orgId: 'org_1',
    createdBy: 'user_a',
    input: baseInput(),
  })

  expect(result.minDays).toBe(7)
  expect(result.significanceThreshold).toBe(0.05)
  expect(result.autoWinner).toBe(false)
  expect(result.status).toBe('draft')
  expect(result.id).toMatch(/^exp_/)
})

// Test 5
it('updateExperiment: rejects variants change when status != draft', async () => {
  const exp = await createExperiment({
    orgId: 'org_1',
    createdBy: 'user_a',
    input: baseInput(),
  })

  // Flip status to running
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
  const key = `ad_experiments/${exp.id}`
  _docs.set(key, { ..._docs.get(key)!, status: 'running' })

  await expect(
    updateExperiment(exp.id, {
      variants: [
        { id: 'a', name: 'Control', trafficPercent: 60 },
        { id: 'b', name: 'B', trafficPercent: 40 },
      ],
    }),
  ).rejects.toThrow('status=draft')
})

// Test 6
it('listExperiments: filters out archived by default', async () => {
  const e1 = await createExperiment({ orgId: 'org_1', createdBy: 'u', input: baseInput() })
  const e2 = await createExperiment({ orgId: 'org_1', createdBy: 'u', input: { ...baseInput(), name: 'Exp 2' } })

  await archiveExperiment(e2.id)

  const list = await listExperiments({ orgId: 'org_1' })
  expect(list).toHaveLength(1)
  expect(list[0].id).toBe(e1.id)
})

// Test 7
it('appendResult: writes to results subcollection', async () => {
  const exp = await createExperiment({ orgId: 'org_1', createdBy: 'u', input: baseInput() })

  const result: AdExperimentResult = {
    id: 'r_a_2024-01-01_2024-01-07',
    experimentId: exp.id,
    variantId: 'a',
    fromDate: '2024-01-01',
    toDate: '2024-01-07',
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    spendCents: 10000,
    ctr: 0.05,
    cpc: 200,
    cpa: 2000,
    convRate: 0.1,
    computedAt: makeFakeTimestamp(),
  }

  await appendResult({ experimentId: exp.id, result })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
  const key = `ad_experiments/${exp.id}/results/${result.id}`
  expect(_docs.has(key)).toBe(true)
})

// Test 8
it('updateExperimentStatus: flips status and sets startedAt/endedAt', async () => {
  const exp = await createExperiment({ orgId: 'org_1', createdBy: 'u', input: baseInput() })
  const startedAt = makeFakeTimestamp(1716100000)

  await updateExperimentStatus(exp.id, 'running', { startedAt })

  const fetched = await getExperiment(exp.id)
  expect(fetched?.status).toBe('running')
  expect(fetched?.startedAt).toEqual(startedAt)

  const endedAt = makeFakeTimestamp(1716200000)
  await updateExperimentStatus(exp.id, 'completed', { endedAt })

  const fetched2 = await getExperiment(exp.id)
  expect(fetched2?.status).toBe('completed')
  expect(fetched2?.endedAt).toEqual(endedAt)
})

// Bonus: listResults with variantId filter
it('listResults: returns results for specific variant', async () => {
  const exp = await createExperiment({ orgId: 'org_1', createdBy: 'u', input: baseInput() })

  const resultA: AdExperimentResult = {
    id: 'r_a_2024-01-01_2024-01-07',
    experimentId: exp.id,
    variantId: 'a',
    fromDate: '2024-01-01',
    toDate: '2024-01-07',
    impressions: 1000, clicks: 50, conversions: 5, spendCents: 10000,
    ctr: 0.05, convRate: 0.1, computedAt: makeFakeTimestamp(),
  }
  const resultB: AdExperimentResult = {
    id: 'r_b_2024-01-01_2024-01-07',
    experimentId: exp.id,
    variantId: 'b',
    fromDate: '2024-01-01',
    toDate: '2024-01-07',
    impressions: 1200, clicks: 60, conversions: 8, spendCents: 12000,
    ctr: 0.05, convRate: 0.13, computedAt: makeFakeTimestamp(),
  }

  await appendResult({ experimentId: exp.id, result: resultA })
  await appendResult({ experimentId: exp.id, result: resultB })

  const aResults = await listResults({ experimentId: exp.id, variantId: 'a' })
  expect(aResults).toHaveLength(1)
  expect(aResults[0].variantId).toBe('a')
})
