// __tests__/lib/ads/experiments/start.test.ts

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTimestampNow = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: (...args: unknown[]) => mockTimestampNow(...args),
  },
}))

jest.mock('@/lib/firebase/admin', () => {
  const docs = new Map<string, Record<string, unknown>>()

  function makeDoc(fullPath: string) {
    return {
      get: async () => ({
        exists: docs.has(fullPath),
        id: fullPath.split('/').pop(),
        data: () => docs.get(fullPath) ?? {},
      }),
      set: async (data: Record<string, unknown>) => {
        docs.set(fullPath, { ...data })
      },
      update: async (patch: Record<string, unknown>) => {
        const cur = docs.get(fullPath) ?? {}
        docs.set(fullPath, { ...cur, ...patch })
      },
      collection: (subName: string) => makeCollection(`${fullPath}/${subName}`),
    }
  }

  function makeCollection(path: string) {
    return {
      doc: (id: string) => makeDoc(`${path}/${id}`),
      where: () => makeCollection(path),
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

import { generateVariantEntities } from '@/lib/ads/experiments/start'
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
      { id: 'a', name: 'Control', trafficPercent: 50 },
      { id: 'b', name: 'Variant B', trafficPercent: 50 },
    ],
    successMetric: 'ctr',
    status: 'draft',
    minDays: 7,
    significanceThreshold: 0.05,
    autoWinner: false,
    createdBy: 'user_1',
    createdAt: makeFakeTimestamp() as ReturnType<typeof makeFakeTimestamp>,
    updatedAt: makeFakeTimestamp() as ReturnType<typeof makeFakeTimestamp>,
    ...overrides,
  } as AdExperiment
}

function seedSourceEntity(id: string, data: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
  _docs.set(`ad_sets/${id}`, { id, ...data })
}

function seedSourceAd(id: string, data: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
  _docs.set(`ads/${id}`, { id, ...data })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
  _docs.clear()
  cryptoCounter = 0
  mockTimestampNow.mockReturnValue(makeFakeTimestamp())
})

// Test 25
it('generateVariantEntities: reuses source entity for control variant (index 0)', async () => {
  seedSourceEntity('as_source', { status: 'active' })
  const exp = makeExperiment()
  const result = await generateVariantEntities({ experiment: exp })

  expect(result.variants[0].entityId).toBe('as_source')
})

// Test 26
it('generateVariantEntities: duplicates source for non-control variants with new ids', async () => {
  seedSourceEntity('as_source', { status: 'active', name: 'Original ad set' })
  const exp = makeExperiment()
  const result = await generateVariantEntities({ experiment: exp })

  // variant b gets a new entityId (not the source id)
  expect(result.variants[1].entityId).toBeDefined()
  expect(result.variants[1].entityId).not.toBe('as_source')
  expect(result.variants[1].entityId).toMatch(/^as_/)

  // Verify the duplicate was actually stored
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
  const dupKey = `ad_sets/${result.variants[1].entityId}`
  expect(_docs.has(dupKey)).toBe(true)
})

// Test 27
it('generateVariantEntities: applies overrides per variant', async () => {
  seedSourceEntity('as_source', { status: 'active', headline: 'Original headline' })
  const exp = makeExperiment({
    variants: [
      { id: 'a', name: 'Control', trafficPercent: 50 },
      { id: 'b', name: 'Variant B', trafficPercent: 50, overrides: { headline: 'B headline', cta: 'Shop Now' } },
    ],
  })

  const result = await generateVariantEntities({ experiment: exp })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
  const bId = result.variants[1].entityId!
  const bDoc = _docs.get(`ad_sets/${bId}`)
  expect(bDoc?.headline).toBe('B headline')
  expect(bDoc?.cta).toBe('Shop Now')
})

// Test 28
it('generateVariantEntities: scales dailyBudgetCents by traffic percent', async () => {
  seedSourceEntity('as_source', { status: 'active', dailyBudgetCents: 10000 })
  const exp = makeExperiment({
    variants: [
      { id: 'a', name: 'Control', trafficPercent: 60 },
      { id: 'b', name: 'Variant B', trafficPercent: 40 },
    ],
  })

  const result = await generateVariantEntities({ experiment: exp })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }

  // Variant B gets 40% of 10000 = 4000
  const bId = result.variants[1].entityId!
  const bDoc = _docs.get(`ad_sets/${bId}`)
  expect(bDoc?.dailyBudgetCents).toBe(4000)

  // Source entity (control) gets 60% of 10000 = 6000
  const aDoc = _docs.get('ad_sets/as_source')
  expect(aDoc?.dailyBudgetCents).toBe(6000)
})

// Test 29
it('generateVariantEntities: tags duplicates with experimentId + experimentVariantId', async () => {
  seedSourceEntity('as_source', { status: 'active' })
  const exp = makeExperiment()
  const result = await generateVariantEntities({ experiment: exp })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
  const bId = result.variants[1].entityId!
  const bDoc = _docs.get(`ad_sets/${bId}`)
  expect(bDoc?.experimentId).toBe('exp_001')
  expect(bDoc?.experimentVariantId).toBe('b')
})

// Test 30
it('generateVariantEntities: throws when source entity not found', async () => {
  // Do NOT seed the source entity
  const exp = makeExperiment()
  await expect(generateVariantEntities({ experiment: exp })).rejects.toThrow('not found in ad_sets')
})
