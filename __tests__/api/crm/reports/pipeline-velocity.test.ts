import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { GET } from '@/app/api/v1/crm/reports/pipeline-velocity/route'

const AI_KEY = 'test-pipeline-velocity-key'
process.env.AI_API_KEY = AI_KEY

function makeReq(orgId = 'org-a') {
  return new NextRequest('http://localhost/api/v1/crm/reports/pipeline-velocity', {
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': orgId },
  })
}

function daysAgo(days: number) {
  return {
    toDate: () => new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  }
}

function setupDeals(deals: Record<string, unknown>[]) {
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
    throw new Error(`Unexpected collection: ${name}`)
  })
}

describe('GET /api/v1/crm/reports/pipeline-velocity', () => {
  beforeEach(() => jest.clearAllMocks())

  it('groups open deals by current pipeline stage and calculates average days', async () => {
    setupDeals([
      {
        orgId: 'org-a',
        pipelineId: 'pipe-a',
        stageId: 'proposal',
        probability: 30,
        deleted: false,
        stageHistory: [{ pipelineId: 'pipe-a', stageId: 'proposal', enteredAt: daysAgo(10) }],
      },
      {
        orgId: 'org-a',
        pipelineId: 'pipe-a',
        stageId: 'proposal',
        probability: 30,
        deleted: false,
        stageHistory: [{ pipelineId: 'pipe-a', stageId: 'proposal', enteredAt: daysAgo(20) }],
      },
    ])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.stages).toHaveLength(1)
    expect(body.data.stages[0]).toEqual(expect.objectContaining({
      pipelineId: 'pipe-a',
      stageId: 'proposal',
      dealCount: 2,
      bottleneck: true,
    }))
    expect(body.data.stages[0].avgDays).toBeGreaterThan(14)
    expect(body.data.summary.bottleneckCount).toBe(1)
  })

  it('falls back to updatedAt when older deals do not have stageHistory', async () => {
    setupDeals([
      {
        orgId: 'org-a',
        pipelineId: 'pipe-a',
        stageId: 'discovery',
        probability: 10,
        deleted: false,
        updatedAt: daysAgo(3),
      },
    ])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.stages[0].stageId).toBe('discovery')
    expect(body.data.stages[0].avgDays).toBeGreaterThan(2)
  })

  it('excludes won, lost, and deleted deals', async () => {
    setupDeals([
      { orgId: 'org-a', pipelineId: 'p', stageId: 'won', probability: 100, stageHistory: [{ pipelineId: 'p', stageId: 'won', enteredAt: daysAgo(5) }] },
      { orgId: 'org-a', pipelineId: 'p', stageId: 'lost', probability: 0, lostReason: 'price', stageHistory: [{ pipelineId: 'p', stageId: 'lost', enteredAt: daysAgo(5) }] },
      { orgId: 'org-a', pipelineId: 'p', stageId: 'proposal', probability: 30, deleted: true, stageHistory: [{ pipelineId: 'p', stageId: 'proposal', enteredAt: daysAgo(5) }] },
    ])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data.stages).toHaveLength(0)
    expect(body.data.summary.stageCount).toBe(0)
  })

  it('queries by org only to stay composite-index safe', async () => {
    const whereMock = jest.fn().mockReturnThis()
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
          where: whereMock,
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })

    await GET(makeReq('org-b'))
    expect(whereMock).toHaveBeenCalledTimes(1)
    expect(whereMock).toHaveBeenCalledWith('orgId', '==', 'org-b')
  })
})
