import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { GET } from '@/app/api/v1/crm/reports/forecast/route'

const AI_KEY = 'test-key'
process.env.AI_API_KEY = AI_KEY

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function makeReq(orgId = ORG_A) {
  return new NextRequest('http://localhost/api/v1/crm/reports/forecast', {
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': orgId },
  })
}

type DocData = Record<string, unknown>

function setupDeals(deals: DocData[]) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
        }),
      }
    }
    if (name === 'deals') {
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: deals.map((d, i) => ({ id: `deal${i}`, data: () => d })),
        }),
      }
    }
    throw new Error(`Unexpected: ${name}`)
  })
}

/** Returns a Firestore-like Timestamp object for a given Date */
function ts(d: Date) {
  return { toDate: () => d }
}

/** Returns a date that falls in the same month as `now` */
function thisMonthDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 15)
}

/** Returns a date that falls in the next calendar month from `now` */
function nextMonthDate(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 10)
  return d
}

/** Returns a date in 6 months (likely beyond next quarter for most months) */
function beyondDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 6, 1)
}

describe('GET /api/v1/crm/reports/forecast', () => {
  beforeEach(() => jest.clearAllMocks())

  it('splits open deals into correct period buckets', async () => {
    const now = new Date()
    setupDeals([
      { orgId: ORG_A, value: 1000, probability: 50, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
      { orgId: ORG_A, value: 2000, probability: 80, expectedCloseDate: ts(nextMonthDate(now)), deleted: false },
      { orgId: ORG_A, value: 500, probability: 30, expectedCloseDate: null, deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.periods.thisMonth.dealCount).toBe(1)
    expect(body.data.periods.nextMonth.dealCount).toBe(1)
    expect(body.data.periods.noDate.dealCount).toBe(1)
  })

  it('excludes won deals (probability === 100)', async () => {
    const now = new Date()
    setupDeals([
      { orgId: ORG_A, value: 5000, probability: 100, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
      { orgId: ORG_A, value: 1000, probability: 50, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.summary.totalOpenDeals).toBe(1)
    expect(body.data.periods.thisMonth.dealCount).toBe(1)
  })

  it('excludes lost deals (lostReason present)', async () => {
    const now = new Date()
    setupDeals([
      { orgId: ORG_A, value: 3000, probability: 40, lostReason: 'price', expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
      { orgId: ORG_A, value: 1000, probability: 60, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.summary.totalOpenDeals).toBe(1)
  })

  it('calculates weightedValue as value × probability/100', async () => {
    const now = new Date()
    setupDeals([
      { orgId: ORG_A, value: 1000, probability: 75, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    // 1000 * 75/100 = 750
    expect(body.data.periods.thisMonth.weightedValue).toBeCloseTo(750)
    expect(body.data.summary.weightedValue).toBeCloseTo(750)
  })

  it('uses default probability of 50 when not set', async () => {
    const now = new Date()
    setupDeals([
      { orgId: ORG_A, value: 1000, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    // 1000 * 50/100 = 500
    expect(body.data.periods.thisMonth.weightedValue).toBeCloseTo(500)
  })

  it('places deals with no expectedCloseDate in noDate bucket', async () => {
    setupDeals([
      { orgId: ORG_A, value: 999, probability: 40, expectedCloseDate: null, deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.periods.noDate.dealCount).toBe(1)
    expect(body.data.periods.noDate.totalValue).toBe(999)
  })

  it('summary totals aggregate all open deals', async () => {
    const now = new Date()
    setupDeals([
      { orgId: ORG_A, value: 1000, probability: 50, expectedCloseDate: ts(thisMonthDate(now)), deleted: false },
      { orgId: ORG_A, value: 2000, probability: 50, expectedCloseDate: ts(beyondDate(now)), deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.summary.totalOpenDeals).toBe(2)
    expect(body.data.summary.totalValue).toBe(3000)
    expect(body.data.summary.weightedValue).toBeCloseTo(1500)
  })

  it('scopes to orgId via Firestore query', async () => {
    const whereMock = jest.fn().mockReturnThis()
    const getMock = jest.fn().mockResolvedValue({ docs: [] })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
          }),
        }
      }
      return { where: whereMock, limit: jest.fn().mockReturnThis(), get: getMock }
    })
    await GET(makeReq(ORG_B))
    expect(whereMock).toHaveBeenCalledWith('orgId', '==', ORG_B)
  })

  it('avoids composite-index-sensitive deleted filters in Firestore', async () => {
    const whereMock = jest.fn().mockReturnThis()
    const getMock = jest.fn().mockResolvedValue({ docs: [] })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
          }),
        }
      }
      return { where: whereMock, limit: jest.fn().mockReturnThis(), get: getMock }
    })

    await GET(makeReq(ORG_A))

    expect(whereMock).toHaveBeenCalledTimes(1)
    expect(whereMock).toHaveBeenCalledWith('orgId', '==', ORG_A)
  })

  it('handles ISO string expectedCloseDate', async () => {
    const now = new Date()
    const isoDate = thisMonthDate(now).toISOString()
    setupDeals([
      { orgId: ORG_A, value: 500, probability: 40, expectedCloseDate: isoDate, deleted: false },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.periods.thisMonth.dealCount).toBe(1)
  })
})
