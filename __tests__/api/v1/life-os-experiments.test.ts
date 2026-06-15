import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockExperimentAdd = jest.fn()
const mockExperimentGet = jest.fn()
const mockExperimentWhere = jest.fn()
const mockExperimentOrderBy = jest.fn()

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

  mockExperimentAdd.mockResolvedValue({ id: 'experiment-1' })
  mockExperimentGet.mockResolvedValue(docs([
    {
      id: 'experiment-existing',
      data: {
        orgId: 'org-1',
        ownerId: 'user-1',
        title: 'Morning cue',
        status: 'planned',
        startDate: '2026-06-15',
        endDate: '2026-06-21',
        hypothesis: 'Cue improves consistency',
        actions: ['walk'],
        evidencePlan: ['4 walks'],
        adaptationSuggestions: [{ type: 'schedule-change', priority: 'medium' }],
      },
    },
  ]))
  mockExperimentOrderBy.mockReturnValue({ get: mockExperimentGet })
  mockExperimentWhere.mockReturnValue({ where: mockExperimentWhere, orderBy: mockExperimentOrderBy, get: mockExperimentGet })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'life_os_experiments') return { add: mockExperimentAdd, where: mockExperimentWhere }
    throw new Error(`Unexpected collection ${name}`)
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('Life OS experiment API routes', () => {
  it('creates and lists structured experiments with adaptation suggestions', async () => {
    const { POST, GET } = await import('@/app/api/v1/life-os/experiments/route')
    const createRes = await POST(new NextRequest('http://localhost/api/v1/life-os/experiments', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        title: 'Morning recovery cue',
        hypothesis: 'Moving recovery before meetings will improve consistency.',
        startDate: '2026-06-15',
        endDate: '2026-06-21',
        actions: ['Put shoes by desk', 'Walk before first meeting'],
        evidence: ['4 walks completed'],
        successCriteria: ['4 walks'],
      }),
    }))
    const createBody = await createRes.json()

    expect(createRes.status).toBe(201)
    expect(mockExperimentAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      ownerId: 'user-1',
      status: 'planned',
      hypothesis: expect.stringContaining('Moving recovery'),
      durationDays: 7,
      adaptationSuggestions: expect.arrayContaining([
        expect.objectContaining({ type: 'schedule-change' }),
      ]),
    }))
    expect(createBody.data.id).toBe('experiment-1')

    const listRes = await GET(new NextRequest('http://localhost/api/v1/life-os/experiments?orgId=org-1&ownerId=user-1'))
    const listBody = await listRes.json()

    expect(listRes.status).toBe(200)
    expect(listBody.data[0]).toMatchObject({ id: 'experiment-existing', status: 'planned' })
    expect(mockExperimentWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })
})
