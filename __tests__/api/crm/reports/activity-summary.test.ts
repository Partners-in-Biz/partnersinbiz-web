import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

// Mock Timestamp so Timestamp.fromDate works without Firebase init
jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    fromDate: (d: Date) => ({ _date: d }),
  },
}))

import { adminDb } from '@/lib/firebase/admin'
import { GET } from '@/app/api/v1/crm/reports/activity-summary/route'

const AI_KEY = 'test-key'
process.env.AI_API_KEY = AI_KEY

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function makeReq(orgId = ORG_A, days?: number) {
  const url = days != null
    ? `http://localhost/api/v1/crm/reports/activity-summary?days=${days}`
    : 'http://localhost/api/v1/crm/reports/activity-summary'
  return new NextRequest(url, {
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': orgId },
  })
}

type DocData = Record<string, unknown>

function ts(d: Date) {
  return { toDate: () => d }
}

function setupActivities(activities: DocData[]) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
        }),
      }
    }
    if (name === 'activities') {
      return {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: activities.map((a, i) => ({ id: `act${i}`, data: () => a })),
        }),
      }
    }
    throw new Error(`Unexpected: ${name}`)
  })
}

describe('GET /api/v1/crm/reports/activity-summary', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns correct byType counts', async () => {
    const now = new Date()
    setupActivities([
      { orgId: ORG_A, type: 'email_sent', createdAt: ts(now) },
      { orgId: ORG_A, type: 'email_sent', createdAt: ts(now) },
      { orgId: ORG_A, type: 'call', createdAt: ts(now) },
      { orgId: ORG_A, type: 'note', createdAt: ts(now) },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.byType.email_sent).toBe(2)
    expect(body.data.byType.call).toBe(1)
    expect(body.data.byType.note).toBe(1)
    expect(body.data.total).toBe(4)
  })

  it('returns perDay sorted ascending', async () => {
    const day1 = new Date('2026-05-01T10:00:00Z')
    const day2 = new Date('2026-05-03T10:00:00Z')
    const day3 = new Date('2026-05-02T10:00:00Z')
    setupActivities([
      { orgId: ORG_A, type: 'call', createdAt: ts(day1) },
      { orgId: ORG_A, type: 'note', createdAt: ts(day2) },
      { orgId: ORG_A, type: 'email_sent', createdAt: ts(day3) },
    ])
    const res = await GET(makeReq())
    const body = await res.json()
    const dates = body.data.perDay.map((p: { date: string }) => p.date)
    expect(dates).toEqual([...dates].sort())
  })

  it('clamps days param to 90', async () => {
    setupActivities([])
    const res = await GET(makeReq(ORG_A, 200))
    const body = await res.json()
    expect(body.data.days).toBe(90)
  })

  it('defaults to days=30 when not provided', async () => {
    setupActivities([])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.days).toBe(30)
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
      return { where: whereMock, get: getMock }
    })
    await GET(makeReq(ORG_B))
    expect(whereMock).toHaveBeenCalledWith('orgId', '==', ORG_B)
  })

  it('only includes activities returned by Firestore (since filter applied at query level)', async () => {
    // Firestore enforces the `createdAt >= since` filter — the route trusts those results.
    // This test confirms that activities returned are included in counts, not filtered again.
    const now = new Date()
    setupActivities([
      { orgId: ORG_A, type: 'stage_change', createdAt: ts(now) },
    ])
    const res = await GET(makeReq(ORG_A, 30))
    const body = await res.json()
    expect(body.data.total).toBe(1)
    expect(body.data.byType.stage_change).toBe(1)
  })
})
