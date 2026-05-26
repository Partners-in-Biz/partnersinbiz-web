import { GET } from '@/app/api/v1/webhooks/queue-stats/route'
import { adminDb } from '@/lib/firebase/admin'
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

process.env.AI_API_KEY = 'test-key'

const baseNow = Date.UTC(2026, 4, 26, 12, 0, 0)

type Doc = Record<string, unknown>

type QueryCall = {
  collection: string
  field: string
  op: string
  value: unknown
}

const queryCalls: QueryCall[] = []

class FakeQuery {
  private readonly filters: QueryCall[]

  constructor(
    private readonly collectionName: string,
    private readonly docs: Doc[],
    filters: QueryCall[] = [],
  ) {
    this.filters = filters
  }

  where(field: string, op: string, value: unknown) {
    if (this.filters.length >= 1) {
      throw new Error(`composite query attempted for ${this.collectionName}`)
    }
    const next = { collection: this.collectionName, field, op, value }
    queryCalls.push(next)
    return new FakeQuery(this.collectionName, this.docs, [next])
  }

  async get() {
    const filtered = this.docs.filter((doc) => this.filters.every((filter) => matches(doc, filter)))
    return {
      empty: filtered.length === 0,
      docs: filtered.map((doc, index) => ({ id: `${this.collectionName}-${index}`, data: () => doc })),
    }
  }
}

function toMillis(value: unknown) {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  return Number(value)
}

function matches(doc: Doc, filter: QueryCall) {
  const actual = doc[filter.field]
  if (filter.op === '==') return actual === filter.value
  if (filter.op === '>=') return toMillis(actual) >= toMillis(filter.value)
  if (filter.op === '<=') return toMillis(actual) <= toMillis(filter.value)
  throw new Error(`unsupported op ${filter.op}`)
}

function installCollections(queueDocs: Doc[], webhookDocs: Doc[]) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'webhook_queue') return new FakeQuery(name, queueDocs)
    if (name === 'outbound_webhooks') return new FakeQuery(name, webhookDocs)
    throw new Error(`unexpected collection ${name}`)
  })
}

function makeReq(search = '') {
  return new NextRequest(`http://localhost/api/v1/webhooks/queue-stats${search}`, {
    headers: { authorization: 'Bearer test-key' },
  })
}

describe('GET /api/v1/webhooks/queue-stats', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(baseNow)
    jest.clearAllMocks()
    queryCalls.length = 0
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('derives org-scoped stats from single-field queries instead of composite indexes', async () => {
    installCollections(
      [
        { orgId: 'org-a', status: 'pending', nextAttemptAt: baseNow - 10_000 },
        { orgId: 'org-a', status: 'delivering', claimedAt: baseNow - 10 * 60_000 },
        { orgId: 'org-a', status: 'delivered', deliveredAt: baseNow - 60_000 },
        { orgId: 'org-a', status: 'failed' },
        { orgId: 'org-b', status: 'pending', nextAttemptAt: baseNow - 60_000 },
      ],
      [
        { orgId: 'org-a', deleted: false, active: true },
        { orgId: 'org-a', deleted: false, active: false, autoDisabledAt: baseNow - 1_000 },
        { orgId: 'org-a', deleted: true, active: true },
        { orgId: 'org-b', deleted: false, active: true },
      ],
    )

    const res = await GET(makeReq('?orgId=org-a'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.byStatus).toEqual({
      pending: 1,
      delivering: 1,
      failed: 1,
      deliveredLast24h: 1,
    })
    expect(body.data.oldestPendingAgeSeconds).toBe(10)
    expect(body.data.stuckDeliveringCount).toBe(1)
    expect(body.data.webhooks).toEqual({ total: 2, active: 1, autoDisabled: 1 })
    expect(queryCalls.map((call) => `${call.collection}.${call.field}`)).toEqual([
      'webhook_queue.orgId',
      'outbound_webhooks.orgId',
    ])
  })

  it('keeps unscoped stats on single-field slices', async () => {
    installCollections(
      [
        { status: 'pending', nextAttemptAt: baseNow - 30_000 },
        { status: 'delivering', claimedAt: baseNow - 2 * 60_000 },
        { status: 'delivering', claimedAt: baseNow - 7 * 60_000 },
        { status: 'delivered', deliveredAt: baseNow - 60_000 },
        { status: 'delivered', deliveredAt: baseNow - 48 * 60 * 60_000 },
        { status: 'failed' },
      ],
      [
        { deleted: false, active: true },
        { deleted: false, active: false, autoDisabledAt: baseNow - 1_000 },
        { deleted: true, active: true },
      ],
    )

    const res = await GET(makeReq())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.byStatus).toEqual({
      pending: 1,
      delivering: 2,
      failed: 1,
      deliveredLast24h: 1,
    })
    expect(body.data.stuckDeliveringCount).toBe(1)
    expect(body.data.webhooks).toEqual({ total: 2, active: 1, autoDisabled: 1 })
    expect(queryCalls.map((call) => `${call.collection}.${call.field}`)).toEqual([
      'webhook_queue.status',
      'webhook_queue.status',
      'webhook_queue.status',
      'webhook_queue.deliveredAt',
      'webhook_queue.claimedAt',
      'outbound_webhooks.deleted',
    ])
  })
})
