import {
  recordCapiEvent,
  getCapiEvent,
  listCapiEvents,
  wasEventProcessed,
} from '@/lib/ads/capi-events/store'

// ─── Timestamp mock ──────────────────────────────────────────────────────────
let nowMillis = 1_700_000_000_000

jest.mock('firebase-admin/firestore', () => {
  const makeTimestamp = (ms: number) => ({
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    isEqual: (other: { toMillis?: () => number }) => other.toMillis?.() === ms,
  })
  return {
    Timestamp: {
      now: () => makeTimestamp(nowMillis),
      fromMillis: (ms: number) => makeTimestamp(ms),
    },
  }
})

// ─── Firestore mock with chainable where + orderBy + limit ───────────────────
jest.mock('@/lib/firebase/admin', () => {
  const docs = new Map<string, Record<string, unknown>>()

  type Filter = [string, string, unknown]

  function makeQuery(
    path: string,
    filters: Filter[] = [],
    ordering: { field: string; dir: 'asc' | 'desc' } | null = null,
    limitN: number | null = null,
  ) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(path, [...filters, [field, op, value]], ordering, limitN),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') =>
        makeQuery(path, filters, { field, dir }, limitN),
      limit: (n: number) =>
        makeQuery(path, filters, ordering, n),
      get: async () => {
        let results = Array.from(docs.entries())
          .filter(([k]) => k.startsWith(`${path}/`))
          .filter(([, data]) =>
            filters.every(([field, op, value]) => {
              const actual = (data as Record<string, unknown>)[field]
              if (op === '==') return actual === value
              if (op === '>=') {
                // Compare Timestamp-like objects by their seconds field
                const actualSec = (actual as { seconds: number } | undefined)?.seconds ?? actual
                const valueSec = (value as { seconds: number } | undefined)?.seconds ?? value
                return (actualSec as number) >= (valueSec as number)
              }
              if (op === '<=') {
                const actualSec = (actual as { seconds: number } | undefined)?.seconds ?? actual
                const valueSec = (value as { seconds: number } | undefined)?.seconds ?? value
                return (actualSec as number) <= (valueSec as number)
              }
              return true
            }),
          )
          .map(([, v]) => v)

        if (ordering) {
          results = results.sort((a, b) => {
            const aVal = (a as Record<string, unknown>)[ordering.field]
            const bVal = (b as Record<string, unknown>)[ordering.field]
            // Support Timestamp-like objects (have .seconds)
            const aN = (aVal as { seconds: number } | undefined)?.seconds ?? (aVal as number) ?? 0
            const bN = (bVal as { seconds: number } | undefined)?.seconds ?? (bVal as number) ?? 0
            return ordering.dir === 'desc' ? bN - aN : aN - bN
          })
        }

        if (limitN !== null) {
          results = results.slice(0, limitN)
        }

        return {
          docs: results.map((v) => ({ data: () => v })),
        }
      },
    }
  }

  const collection = (path: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: docs.has(`${path}/${id}`),
        id,
        data: () => docs.get(`${path}/${id}`),
      }),
      set: async (data: Record<string, unknown>) => {
        docs.set(`${path}/${id}`, { ...data })
      },
    }),
    where: (field: string, op: string, value: unknown) =>
      makeQuery(path, [[field, op, value]]),
  })

  return {
    adminDb: { collection },
    _docs: docs,
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ts(ms: number) {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    isEqual: (other: { toMillis?: () => number }) => other.toMillis?.() === ms,
  } as unknown as import('firebase-admin/firestore').Timestamp
}

function baseArgs(overrides: Partial<Parameters<typeof recordCapiEvent>[0]> = {}): Parameters<typeof recordCapiEvent>[0] {
  return {
    event_id: 'evt_abc123',
    orgId: 'org_1',
    pixelConfigId: 'pxc_001',
    eventName: 'Purchase',
    eventTime: ts(1_700_000_000_000),
    userHash: { em: 'abc123hash' },
    actionSource: 'website' as const,
    optOut: false,
    fanout: { meta: { status: 'sent' as const, sentAt: ts(1_700_000_000_000) } },
    ...overrides,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _docs } = require('@/lib/firebase/admin') as { _docs: Map<string, unknown> }
  _docs.clear()
  nowMillis = 1_700_000_000_000
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('capi-events store', () => {
  it('recordCapiEvent stores with id = event_id (not a generated ID)', async () => {
    const event = await recordCapiEvent(baseArgs({ event_id: 'pixel_evt_42' }))

    expect(event.id).toBe('pixel_evt_42')

    // Verify it's actually fetchable under that exact ID
    const fetched = await getCapiEvent('pixel_evt_42')
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe('pixel_evt_42')
    expect(fetched!.orgId).toBe('org_1')
    expect(fetched!.eventName).toBe('Purchase')
  })

  describe('wasEventProcessed', () => {
    it('returns true for an event that was recorded under the same org', async () => {
      await recordCapiEvent(baseArgs({ event_id: 'seen_evt', orgId: 'org_A' }))
      const result = await wasEventProcessed('org_A', 'seen_evt')
      expect(result).toBe(true)
    })

    it('returns false for an event that has never been recorded', async () => {
      const result = await wasEventProcessed('org_A', 'never_seen_evt')
      expect(result).toBe(false)
    })

    it('returns false for cross-org collision — same event_id but different orgId', async () => {
      // org_A records an event with event_id 'shared_id'
      await recordCapiEvent(baseArgs({ event_id: 'shared_id', orgId: 'org_A' }))

      // org_B uses the same event_id string — must not be treated as processed for org_B
      const result = await wasEventProcessed('org_B', 'shared_id')
      expect(result).toBe(false)
    })
  })

  it('listCapiEvents filters by orgId + eventName and sorts by eventTime desc', async () => {
    const t1 = ts(1_700_000_001_000)
    const t2 = ts(1_700_000_002_000)
    const t3 = ts(1_700_000_003_000)

    // Two Purchase events for org_1
    await recordCapiEvent(baseArgs({ event_id: 'e1', orgId: 'org_1', eventName: 'Purchase', eventTime: t1 }))
    await recordCapiEvent(baseArgs({ event_id: 'e2', orgId: 'org_1', eventName: 'Purchase', eventTime: t3 }))
    // A Lead event for org_1
    await recordCapiEvent(baseArgs({ event_id: 'e3', orgId: 'org_1', eventName: 'Lead', eventTime: t2 }))

    const purchases = await listCapiEvents({ orgId: 'org_1', eventName: 'Purchase' })

    expect(purchases).toHaveLength(2)
    // desc order: e2 (t3) before e1 (t1)
    expect(purchases[0].id).toBe('e2')
    expect(purchases[1].id).toBe('e1')
  })

  it('listCapiEvents applies default limit of 100', async () => {
    // Record 105 events for org_1
    for (let i = 0; i < 105; i++) {
      await recordCapiEvent(
        baseArgs({ event_id: `bulk_evt_${i}`, orgId: 'org_limit', eventTime: ts(1_700_000_000_000 + i * 1000) }),
      )
    }

    const result = await listCapiEvents({ orgId: 'org_limit' })
    expect(result.length).toBe(100)
  })

  it('cross-tenant isolation: listCapiEvents for orgA never returns orgB events', async () => {
    await recordCapiEvent(baseArgs({ event_id: 'evt_a1', orgId: 'org_A', eventName: 'Purchase' }))
    await recordCapiEvent(baseArgs({ event_id: 'evt_b1', orgId: 'org_B', eventName: 'Purchase' }))
    await recordCapiEvent(baseArgs({ event_id: 'evt_b2', orgId: 'org_B', eventName: 'Lead' }))

    const orgAEvents = await listCapiEvents({ orgId: 'org_A' })

    expect(orgAEvents).toHaveLength(1)
    expect(orgAEvents[0].orgId).toBe('org_A')
    expect(orgAEvents[0].id).toBe('evt_a1')
    // Ensure org_B IDs are absent
    const ids = orgAEvents.map((e) => e.id)
    expect(ids).not.toContain('evt_b1')
    expect(ids).not.toContain('evt_b2')
  })
})
