import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { GET } from '@/app/api/v1/crm/reports/rep-performance/route'

const AI_KEY = 'test-rep-performance-key'
process.env.AI_API_KEY = AI_KEY

function makeReq(orgId = 'org-a') {
  return new NextRequest('http://localhost/api/v1/crm/reports/rep-performance', {
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': orgId },
  })
}

function setupData(
  deals: Record<string, unknown>[],
  activities: Record<string, unknown>[],
  contacts: Record<string, unknown>[] = [],
) {
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
          docs: deals.map((deal, index) => ({ id: `deal-${index}`, data: () => deal })),
        }),
      }
    }
    if (name === 'activities') {
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: activities.map((activity, index) => ({ id: `activity-${index}`, data: () => activity })),
        }),
      }
    }
    if (name === 'contacts') {
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: contacts.map((contact, index) => ({ id: `contact-${index}`, data: () => contact })),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

describe('GET /api/v1/crm/reports/rep-performance', () => {
  beforeEach(() => jest.clearAllMocks())

  it('aggregates deal outcomes and activities by owner/actor', async () => {
    setupData(
      [
        { ownerUid: 'u1', ownerRef: { uid: 'u1', displayName: 'Alice' }, value: 1000, probability: 100, deleted: false },
        { ownerUid: 'u1', ownerRef: { uid: 'u1', displayName: 'Alice' }, value: 3000, probability: 50, deleted: false },
        { ownerUid: 'u2', ownerRef: { uid: 'u2', displayName: 'Bob' }, value: 500, lostReason: 'price', deleted: false },
      ],
      [
        { createdBy: 'u1', createdByRef: { uid: 'u1', displayName: 'Alice' } },
        { createdBy: 'u1', createdByRef: { uid: 'u1', displayName: 'Alice' } },
        { createdBy: 'u2', createdByRef: { uid: 'u2', displayName: 'Bob' } },
      ],
    )

    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.reps[0]).toEqual(expect.objectContaining({
      uid: 'u1',
      displayName: 'Alice',
      wonDeals: 1,
      openDeals: 1,
      openValue: 3000,
      wonValue: 1000,
      activities: 2,
    }))
    expect(body.data.reps.find((rep: { uid: string }) => rep.uid === 'u2')).toEqual(expect.objectContaining({
      lostDeals: 1,
      activities: 1,
      winRate: 0,
    }))
  })

  it('keeps unassigned deals visible instead of dropping them', async () => {
    setupData([{ value: 1200, probability: 20, deleted: false }], [])
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.reps[0]).toEqual(expect.objectContaining({
      uid: 'unassigned',
      displayName: 'Unassigned',
      openDeals: 1,
    }))
  })

  it('surfaces contact owner coverage for operating accountability', async () => {
    setupData(
      [],
      [],
      [
        { assignedTo: 'u1', deleted: false },
        { assignedToRef: { uid: 'u2', displayName: 'Bob' }, deleted: false },
        { assignedTo: '', deleted: false },
        { assignedTo: 'u3', deleted: true },
      ],
    )

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.summary).toEqual(expect.objectContaining({
      totalContacts: 3,
      unassignedContacts: 1,
      contactOwnerCoverage: 2 / 3,
    }))
  })

  it('reads deals, activities, and contacts with org-only query shapes', async () => {
    const whereMocks: jest.Mock[] = []
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: {} }) }),
          }),
        }
      }
      const where = jest.fn().mockReturnThis()
      whereMocks.push(where)
      return {
        where,
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
    })

    await GET(makeReq('org-b'))
    expect(whereMocks).toHaveLength(3)
    expect(whereMocks[0]).toHaveBeenCalledWith('orgId', '==', 'org-b')
    expect(whereMocks[1]).toHaveBeenCalledWith('orgId', '==', 'org-b')
    expect(whereMocks[2]).toHaveBeenCalledWith('orgId', '==', 'org-b')
  })
})
