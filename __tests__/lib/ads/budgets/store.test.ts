// __tests__/lib/ads/budgets/store.test.ts

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Must mock before importing the module under test
const mockTimestampNow = jest.fn()
const mockTimestampFromDate = jest.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d }))
const mockFieldValueDelete = jest.fn(() => ({ __delete: true }))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: (...args: unknown[]) => mockTimestampNow(...args),
    fromDate: (d: Date) => mockTimestampFromDate(d),
  },
  FieldValue: {
    delete: () => mockFieldValueDelete(),
  },
}))

jest.mock('@/lib/firebase/admin', () => {
  // Supports nested subcollections via dot-path keys: 'collection/docId/sub/subId'
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
    }
  }

  return {
    adminDb: { collection: (name: string) => makeCollection(name) },
    _docs: docs,
  }
})

let cryptoCounter = 0
jest.mock('crypto', () => {
  return {
    randomBytes: (n: number) => {
      const val = String(cryptoCounter++).padStart(n * 2, '0')
      return { toString: () => val.slice(0, n * 2) }
    },
  }
})

// ─── Subject ─────────────────────────────────────────────────────────────────

import {
  computeWindowStart,
  createBudget,
  getBudget,
  listBudgets,
  updateBudget,
  appendEvent,
} from '@/lib/ads/budgets/store'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeTimestamp(seconds: number) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
  _docs.clear()
  cryptoCounter = 0

  const fakeNow = makeFakeTimestamp(1716000000)
  mockTimestampNow.mockReturnValue(fakeNow)
})

describe('computeWindowStart', () => {
  it('daily returns UTC midnight of today', () => {
    // Use a known date: 2024-05-18 (a Saturday)
    const date = new Date('2024-05-18T14:30:00Z')
    const result = computeWindowStart('daily', date)
    // Should be 2024-05-18T00:00:00Z
    const expected = new Date(Date.UTC(2024, 4, 18, 0, 0, 0, 0))
    expect(result.seconds).toBe(Math.floor(expected.getTime() / 1000))
  })

  it('weekly returns Monday UTC midnight of current week', () => {
    // 2024-05-18 is a Saturday. Monday of that week is 2024-05-13.
    const date = new Date('2024-05-18T14:30:00Z')
    const result = computeWindowStart('weekly', date)
    const expected = new Date(Date.UTC(2024, 4, 13, 0, 0, 0, 0))
    expect(result.seconds).toBe(Math.floor(expected.getTime() / 1000))
  })

  it('weekly on a Monday returns that same Monday', () => {
    // 2024-05-13 is a Monday
    const date = new Date('2024-05-13T08:00:00Z')
    const result = computeWindowStart('weekly', date)
    const expected = new Date(Date.UTC(2024, 4, 13, 0, 0, 0, 0))
    expect(result.seconds).toBe(Math.floor(expected.getTime() / 1000))
  })

  it('monthly returns first of current UTC month at midnight', () => {
    const date = new Date('2024-05-18T14:30:00Z')
    const result = computeWindowStart('monthly', date)
    const expected = new Date(Date.UTC(2024, 4, 1, 0, 0, 0, 0))
    expect(result.seconds).toBe(Math.floor(expected.getTime() / 1000))
  })
})

describe('createBudget', () => {
  it('generates bgt_ prefixed id + applies defaults for currencyCode and alertThresholds', async () => {
    const result = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: {
        scope: 'org',
        capCents: 100000,
        period: 'monthly',
        name: 'Monthly Org Cap',
      },
    })

    expect(result.id).toMatch(/^bgt_/)
    expect(result.currencyCode).toBe('USD')
    expect(result.alertThresholds).toEqual([75, 90, 100])
    expect(result.autoPause).toBe(false)
    expect(result.firedThresholds).toEqual([])
    expect(result.orgId).toBe('org_1')
    expect(result.createdBy).toBe('user_a')
  })

  it('throws when scope=platform but platform not provided', async () => {
    await expect(
      createBudget({
        orgId: 'org_1',
        createdBy: 'user_a',
        input: {
          scope: 'platform',
          capCents: 50000,
          period: 'monthly',
          name: 'Platform Cap',
        },
      }),
    ).rejects.toThrow('platform scope requires platform field')
  })

  it('throws when scope=campaign but campaignId not provided', async () => {
    await expect(
      createBudget({
        orgId: 'org_1',
        createdBy: 'user_a',
        input: {
          scope: 'campaign',
          platform: 'meta',
          capCents: 10000,
          period: 'daily',
          name: 'Campaign Cap',
          // no campaignId
        },
      }),
    ).rejects.toThrow('campaign scope requires platform + campaignId fields')
  })

  it('throws on zero capCents', async () => {
    await expect(
      createBudget({
        orgId: 'org_1',
        createdBy: 'user_a',
        input: {
          scope: 'org',
          capCents: 0,
          period: 'monthly',
          name: 'Bad Cap',
        },
      }),
    ).rejects.toThrow('capCents must be a positive integer')
  })

  it('throws on negative capCents', async () => {
    await expect(
      createBudget({
        orgId: 'org_1',
        createdBy: 'user_a',
        input: {
          scope: 'org',
          capCents: -500,
          period: 'monthly',
          name: 'Negative Cap',
        },
      }),
    ).rejects.toThrow('capCents must be a positive integer')
  })
})

describe('listBudgets', () => {
  it('filters out archived budgets by default', async () => {
    // Create two budgets
    const b1 = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 100000, period: 'monthly', name: 'Active Budget' },
    })
    const b2 = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 50000, period: 'monthly', name: 'Archived Budget' },
    })

    // Manually mark b2 as archived in the mock store
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
    const b2Key = `ad_budgets/${b2.id}`
    const b2Data = _docs.get(b2Key)!
    _docs.set(b2Key, { ...b2Data, archivedAt: makeFakeTimestamp(1716001000) })

    const list = await listBudgets({ orgId: 'org_1' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(b1.id)
  })

  it('includes archived budgets when includeArchived=true', async () => {
    await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 100000, period: 'monthly', name: 'Budget A' },
    })
    const b2 = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 50000, period: 'monthly', name: 'Budget B' },
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, Record<string, unknown>> }
    const b2Key = `ad_budgets/${b2.id}`
    const b2Data = _docs.get(b2Key)!
    _docs.set(b2Key, { ...b2Data, archivedAt: makeFakeTimestamp(1716001000) })

    const list = await listBudgets({ orgId: 'org_1', includeArchived: true })
    expect(list).toHaveLength(2)
  })
})

describe('updateBudget', () => {
  it('validates capCents positivity on update', async () => {
    const budget = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 100000, period: 'monthly', name: 'Budget' },
    })

    await expect(
      updateBudget(budget.id, { capCents: -1 }),
    ).rejects.toThrow('capCents must be a positive integer')

    await expect(
      updateBudget(budget.id, { capCents: 0 }),
    ).rejects.toThrow('capCents must be a positive integer')
  })

  it('updates valid patch fields on a budget', async () => {
    const budget = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 100000, period: 'monthly', name: 'Budget' },
    })

    await updateBudget(budget.id, { name: 'Renamed Budget', capCents: 200000 })

    const fetched = await getBudget(budget.id)
    expect(fetched?.name).toBe('Renamed Budget')
    expect(fetched?.capCents).toBe(200000)
  })
})

describe('appendEvent', () => {
  it('writes to events subcollection with evt_ prefixed id', async () => {
    const budget = await createBudget({
      orgId: 'org_1',
      createdBy: 'user_a',
      input: { scope: 'org', capCents: 100000, period: 'monthly', name: 'Budget' },
    })

    const evt = await appendEvent({
      budgetId: budget.id,
      type: 'pacing_check',
      spendCents: 75000,
      percent: 75,
    })

    expect(evt.id).toMatch(/^evt_/)
    expect(evt.budgetId).toBe(budget.id)
    expect(evt.type).toBe('pacing_check')
    expect(evt.spendCents).toBe(75000)
    expect(evt.percent).toBe(75)

    // Verify it was stored in the subcollection
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
    const evtKey = `ad_budgets/${budget.id}/events/${evt.id}`
    expect(_docs.has(evtKey)).toBe(true)
  })
})
