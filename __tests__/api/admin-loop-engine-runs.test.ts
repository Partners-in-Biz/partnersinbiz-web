import { NextRequest } from 'next/server'

const mockCanAccessOrg = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) =>
    handler(req, { uid: 'admin-1', role: 'admin', allowedOrgIds: [], agentId: 'theo' }),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

function runDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCanAccessOrg.mockReturnValue(true)
  const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
  mockCollection.mockReturnValue(query)
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockGet.mockResolvedValue({ docs: [] })
})

describe('GET /api/v1/admin/loop-engine/runs', () => {
  it('filters loopId in memory after an index-safe org ordered query', async () => {
    mockGet.mockResolvedValue({
      docs: [
        runDoc('dispatch-1', {
          orgId: 'pib-platform-owner',
          loopId: 'agent-task-dispatch',
          updatedAt: { toDate: () => new Date('2026-06-20T08:00:00.000Z') },
        }),
        runDoc('business-1', {
          orgId: 'pib-platform-owner',
          loopId: 'business-insight-review',
          updatedAt: { toDate: () => new Date('2026-06-20T07:00:00.000Z') },
        }),
        runDoc('evolution-1', {
          orgId: 'pib-platform-owner',
          loopId: 'agent-evolution-review',
          updatedAt: { toDate: () => new Date('2026-06-20T06:00:00.000Z') },
        }),
      ],
    })

    const { GET } = await import('@/app/api/v1/admin/loop-engine/runs/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/loop-engine/runs?orgId=pib-platform-owner&loopId=business-insight-review&limit=2'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCollection).toHaveBeenCalledWith('loop_engine_runs')
    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockOrderBy).toHaveBeenCalledWith('updatedAt', 'desc')
    expect(mockLimit).toHaveBeenCalledWith(10)
    expect(body.data.runs).toEqual([
      expect.objectContaining({ id: 'business-1', loopId: 'business-insight-review', updatedAt: '2026-06-20T07:00:00.000Z' }),
    ])
  })
})
