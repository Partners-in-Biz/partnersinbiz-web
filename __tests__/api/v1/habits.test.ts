import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockHabitAdd = jest.fn()
const mockHabitGet = jest.fn()
const mockHabitWhere = jest.fn()
const mockHabitOrderBy = jest.fn()
const mockHabitDoc = jest.fn()
const mockHabitDocGet = jest.fn()
const mockHabitDocUpdate = jest.fn()
const mockCheckInDoc = jest.fn()
const mockCheckInSet = jest.fn()
const mockCheckInGet = jest.fn()
const mockCheckInWhere = jest.fn()
const mockCheckInOrderBy = jest.fn()

const mockUser = { uid: 'user-1', role: 'admin' as const, orgId: 'org-1' }
type MockAuthHandler = (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: MockAuthHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

function docs(items: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: items.map((item) => ({ id: item.id, data: () => item.data })) }
}

const habitData = {
  id: 'habit-1',
  orgId: 'org-1',
  ownerId: 'user-1',
  title: 'Walk',
  status: 'active',
  schedule: { cadence: 'daily', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], targetPerWeek: 7, timezone: 'UTC' },
  minimumViableAction: 'Walk for 5 minutes',
  startDate: '2026-06-08',
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date('2026-06-15T08:00:00.000Z'))

  mockHabitAdd.mockResolvedValue({ id: 'habit-new' })
  mockHabitGet.mockResolvedValue(docs([{ id: 'habit-1', data: habitData }]))
  mockHabitOrderBy.mockReturnValue({ get: mockHabitGet })
  mockHabitWhere.mockReturnValue({ orderBy: mockHabitOrderBy, where: mockHabitWhere, get: mockHabitGet })
  mockHabitDocGet.mockResolvedValue({ exists: true, id: 'habit-1', data: () => habitData })
  mockHabitDocUpdate.mockResolvedValue(undefined)
  mockHabitDoc.mockReturnValue({ get: mockHabitDocGet, update: mockHabitDocUpdate })

  mockCheckInSet.mockResolvedValue(undefined)
  mockCheckInDoc.mockReturnValue({ set: mockCheckInSet })
  mockCheckInGet.mockResolvedValue(docs([
    { id: 'ci-1', data: { habitId: 'habit-1', orgId: 'org-1', ownerId: 'user-1', localDate: '2026-06-08', completed: true, frictionReasons: [], updatedAt: '2026-06-08T08:00:00.000Z' } },
    { id: 'ci-2', data: { habitId: 'habit-1', orgId: 'org-1', ownerId: 'user-1', localDate: '2026-06-09', completed: false, frictionReasons: ['too-busy'], updatedAt: '2026-06-09T08:00:00.000Z' } },
  ]))
  mockCheckInOrderBy.mockReturnValue({ get: mockCheckInGet })
  mockCheckInWhere.mockReturnValue({ where: mockCheckInWhere, orderBy: mockCheckInOrderBy, get: mockCheckInGet })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'habits') return { add: mockHabitAdd, where: mockHabitWhere, doc: mockHabitDoc }
    if (name === 'habitCheckIns') return { doc: mockCheckInDoc, where: mockCheckInWhere }
    throw new Error(`Unexpected collection ${name}`)
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('habit API routes', () => {
  it('creates and lists tenant-scoped habits', async () => {
    const { POST, GET } = await import('@/app/api/v1/habits/route')
    const createRes = await POST(new NextRequest('http://localhost/api/v1/habits', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', title: 'Walk', schedule: { cadence: 'daily' }, minimumViableAction: 'Walk for 5 minutes' }),
    }))
    const createBody = await createRes.json()

    expect(createRes.status).toBe(201)
    expect(mockHabitAdd).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', title: 'Walk', ownerId: 'user-1' }))
    expect(createBody.data.id).toBe('habit-new')

    const listRes = await GET(new NextRequest('http://localhost/api/v1/habits?orgId=org-1'))
    const listBody = await listRes.json()

    expect(listRes.status).toBe(200)
    expect(listBody.data[0]).toMatchObject({ id: 'habit-1', title: 'Walk' })
    expect(mockHabitWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })

  it('records a habit check-in with friction recovery copy', async () => {
    const { POST } = await import('@/app/api/v1/habits/[id]/check-ins/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/habits/habit-1/check-ins', {
      method: 'POST',
      body: JSON.stringify({ localDate: '2026-06-15', completed: false, frictionReasons: ['too-tired'] }),
    }), { params: Promise.resolve({ id: 'habit-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockCheckInSet).toHaveBeenCalledWith(expect.objectContaining({
      habitId: 'habit-1',
      orgId: 'org-1',
      completed: false,
      frictionReasons: ['too-tired'],
      recoverySuggestion: expect.stringContaining('Walk for 5 minutes'),
    }), { merge: true })
    expect(body.data.recoverySuggestion.toLowerCase()).not.toContain('failed')
  })

  it('returns weekly habit health summaries', async () => {
    const { GET } = await import('@/app/api/v1/habits/summary/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/habits/summary?orgId=org-1&weekStart=2026-06-08&today=2026-06-09'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data[0]).toMatchObject({
      habitId: 'habit-1',
      frictionReasons: [{ reason: 'too-busy', count: 1 }],
      weekly: expect.objectContaining({ weekStart: '2026-06-08', scheduled: 7 }),
    })
    expect(body.data[0].weekly.summary.toLowerCase()).not.toContain('failure')
  })
})
