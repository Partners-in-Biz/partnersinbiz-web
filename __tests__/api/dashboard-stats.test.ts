// __tests__/api/dashboard-stats.test.ts
import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))
jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (_role: string, handler: Function) => handler,
}))

process.env.AI_API_KEY = 'test-key'
const authHeader = { Authorization: 'Bearer test-key' }

// Default pipeline with 'won' stage kind
const DEFAULT_PIPELINE_DOC = {
  orgId: 'org-1',
  stages: [
    { id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 },
    { id: 'won',       label: 'Won',       kind: 'won',  order: 1, probability: 100 },
    { id: 'lost',      label: 'Lost',      kind: 'lost', order: 2, probability: 0 },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
})

describe('GET /api/v1/dashboard/stats', () => {
  it('returns aggregate stats with wonValue computed via stage.kind', async () => {
    mockGet
      // contacts
      .mockResolvedValueOnce({ docs: [{ id: 'c1', data: () => ({}) }, { id: 'c2', data: () => ({}) }] })
      // deals — stageId-based (not legacy stage string)
      .mockResolvedValueOnce({ docs: [
        { id: 'd1', data: () => ({ stageId: 'discovery', value: 5000 }) },
        { id: 'd2', data: () => ({ stageId: 'won',       value: 10000 }) },
      ]})
      // pipelines
      .mockResolvedValueOnce({ docs: [{ data: () => DEFAULT_PIPELINE_DOC }] })
      // emails sent
      .mockResolvedValueOnce({ docs: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] })
      // emails opened
      .mockResolvedValueOnce({ docs: [{ id: 'e1' }] })
      // active sequences
      .mockResolvedValueOnce({ docs: [{ id: 's1' }] })
      // active enrollments
      .mockResolvedValueOnce({ docs: [{ id: 'en1' }, { id: 'en2' }] })

    const { GET } = await import('@/app/api/v1/dashboard/stats/route')
    const req = new NextRequest('http://localhost/api/v1/dashboard/stats', { headers: authHeader })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contacts.total).toBe(2)
    expect(body.data.deals.pipelineValue).toBe(15000)
    expect(body.data.deals.wonValue).toBe(10000)
    expect(body.data.email.sent).toBe(3)
    expect(body.data.email.opened).toBe(1)
    expect(body.data.sequences.active).toBe(1)
    expect(body.data.sequences.activeEnrollments).toBe(2)
  })

  it('wonValue is 0 when no pipeline has a won-kind stage matching any deal stageId', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [{ id: 'c1', data: () => ({}) }] })
      .mockResolvedValueOnce({ docs: [
        { id: 'd1', data: () => ({ stageId: 'discovery', value: 8000 }) },
      ]})
      // Pipeline with no won stage matching the deal
      .mockResolvedValueOnce({ docs: [{ data: () => ({
        orgId: 'org-1',
        stages: [{ id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 }],
      })}] })
      .mockResolvedValueOnce({ docs: [] }) // emails sent
      .mockResolvedValueOnce({ docs: [] }) // emails opened
      .mockResolvedValueOnce({ docs: [] }) // sequences
      .mockResolvedValueOnce({ docs: [] }) // enrollments

    // Re-import (jest module cache is shared; isolateModules or use jest.resetModules if needed)
    jest.resetModules()
    const { GET } = await import('@/app/api/v1/dashboard/stats/route')
    const req = new NextRequest('http://localhost/api/v1/dashboard/stats', { headers: authHeader })
    const res = await GET(req)
    const body = await res.json()
    expect(body.data.deals.wonValue).toBe(0)
  })
})
