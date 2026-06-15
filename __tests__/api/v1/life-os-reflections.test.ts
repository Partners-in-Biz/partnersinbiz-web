import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockCheckInAdd = jest.fn()
const mockCheckInGet = jest.fn()
const mockCheckInWhere = jest.fn()
const mockCheckInOrderBy = jest.fn()
const mockReviewAdd = jest.fn()
const mockReviewGet = jest.fn()
const mockReviewWhere = jest.fn()
const mockReviewOrderBy = jest.fn()

const mockUser = { uid: 'user-1', role: 'admin' as const, orgId: 'org-1' }
type MockAuthHandler = (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: MockAuthHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

function docs(items: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: items.map((item) => ({ id: item.id, data: () => item.data })) }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date('2026-06-15T08:00:00.000Z'))

  mockCheckInAdd.mockResolvedValue({ id: 'daily-1' })
  mockCheckInGet.mockResolvedValue(docs([
    { id: 'daily-existing', data: { orgId: 'org-1', ownerId: 'user-1', localDate: '2026-06-14', type: 'daily', energy: 3, mood: 4, wins: ['win'], misses: [], lessons: [], blockers: [], priorities: [], nextExperiments: [], dashboardSignals: { winCount: 1 } } },
  ]))
  mockCheckInOrderBy.mockReturnValue({ get: mockCheckInGet })
  mockCheckInWhere.mockReturnValue({ where: mockCheckInWhere, orderBy: mockCheckInOrderBy, get: mockCheckInGet })

  mockReviewAdd.mockResolvedValue({ id: 'weekly-1' })
  mockReviewGet.mockResolvedValue(docs([
    { id: 'weekly-existing', data: { orgId: 'org-1', ownerId: 'user-1', periodType: 'weekly', periodStart: '2026-06-08', periodEnd: '2026-06-14', energy: 4, mood: 3, wins: [], misses: ['miss'], lessons: ['lesson'], blockers: ['blocker'], priorities: ['priority'], nextExperiments: ['experiment'], dashboardSignals: { experimentCount: 1 } } },
  ]))
  mockReviewOrderBy.mockReturnValue({ get: mockReviewGet })
  mockReviewWhere.mockReturnValue({ where: mockReviewWhere, orderBy: mockReviewOrderBy, get: mockReviewGet })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'life_os_check_ins') return { add: mockCheckInAdd, where: mockCheckInWhere }
    if (name === 'life_os_reviews') return { add: mockReviewAdd, where: mockReviewWhere }
    throw new Error(`Unexpected collection ${name}`)
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('Life OS reflection API routes', () => {
  it('creates and lists daily check-ins with coach/dashboard output', async () => {
    const { POST, GET } = await import('@/app/api/v1/life-os/check-ins/route')
    const createRes = await POST(new NextRequest('http://localhost/api/v1/life-os/check-ins', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        localDate: '2026-06-15',
        wins: ['Protected focus'],
        misses: ['Skipped admin'],
        lessons: ['Batch admin earlier'],
        energy: 3,
        mood: 4,
        blockers: ['context switching'],
        priorities: ['finish flow'],
        nextExperiments: ['admin before lunch'],
      }),
    }))
    const createBody = await createRes.json()

    expect(createRes.status).toBe(201)
    expect(mockCheckInAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      ownerId: 'user-1',
      type: 'daily',
      dashboardSignals: expect.objectContaining({ winCount: 1, missCount: 1 }),
      coachContext: expect.objectContaining({ nextCoachPrompt: expect.any(String) }),
    }))
    expect(createBody.data.id).toBe('daily-1')

    const listRes = await GET(new NextRequest('http://localhost/api/v1/life-os/check-ins?orgId=org-1&ownerId=user-1'))
    const listBody = await listRes.json()

    expect(listRes.status).toBe(200)
    expect(listBody.data[0]).toMatchObject({ id: 'daily-existing', type: 'daily' })
    expect(mockCheckInWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })

  it('creates and lists weekly reviews with coach/dashboard output', async () => {
    const { POST, GET } = await import('@/app/api/v1/life-os/reviews/route')
    const createRes = await POST(new NextRequest('http://localhost/api/v1/life-os/reviews', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        weekStart: '2026-06-15',
        weekEnd: '2026-06-21',
        wins: ['Shipped a feature'],
        misses: ['Missed workout'],
        lessons: ['Morning wins'],
        energy: 4,
        mood: 4,
        blockers: ['late nights'],
        priorities: ['protect sleep'],
        nextExperiments: ['phone outside bedroom'],
      }),
    }))
    const createBody = await createRes.json()

    expect(createRes.status).toBe(201)
    expect(mockReviewAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      ownerId: 'user-1',
      periodType: 'weekly',
      dashboardSignals: expect.objectContaining({ lessonCount: 1, experimentCount: 1 }),
      coachContext: expect.objectContaining({ nextCoachPrompt: expect.any(String) }),
    }))
    expect(createBody.data.id).toBe('weekly-1')

    const listRes = await GET(new NextRequest('http://localhost/api/v1/life-os/reviews?orgId=org-1&ownerId=user-1'))
    const listBody = await listRes.json()

    expect(listRes.status).toBe(200)
    expect(listBody.data[0]).toMatchObject({ id: 'weekly-existing', periodType: 'weekly' })
    expect(mockReviewWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })
})
