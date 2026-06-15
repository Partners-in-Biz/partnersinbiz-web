import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockPreferencesDoc = jest.fn()
const mockPreferencesGet = jest.fn()
const mockPreferencesSet = jest.fn()
const mockReminderAdd = jest.fn()
const mockReminderGet = jest.fn()
const mockReminderWhere = jest.fn()
const mockReminderOrderBy = jest.fn()

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
  jest.useFakeTimers().setSystemTime(new Date('2026-06-15T05:45:00.000Z'))

  mockPreferencesGet.mockResolvedValue({ exists: true, data: () => ({
    orgId: 'org-1',
    ownerId: 'user-1',
    optedIn: true,
    channels: { inApp: true, push: true, email: false },
    quietHours: { start: '21:00', end: '07:00', timezone: 'Africa/Johannesburg' },
    enabledKinds: ['daily-check-in', 'habit-prompt', 'weekly-review', 'recovery-nudge'],
  }) })
  mockPreferencesSet.mockResolvedValue(undefined)
  mockPreferencesDoc.mockReturnValue({ get: mockPreferencesGet, set: mockPreferencesSet })

  mockReminderAdd.mockResolvedValue({ id: 'reminder-1' })
  mockReminderGet.mockResolvedValue(docs([
    { id: 'reminder-existing', data: { orgId: 'org-1', ownerId: 'user-1', kind: 'daily-check-in', status: 'scheduled', scheduledFor: '2026-06-15T07:30:00.000+02:00' } },
  ]))
  mockReminderOrderBy.mockReturnValue({ get: mockReminderGet })
  mockReminderWhere.mockReturnValue({ where: mockReminderWhere, orderBy: mockReminderOrderBy, get: mockReminderGet })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'life_os_reminder_preferences') return { doc: mockPreferencesDoc }
    if (name === 'life_os_reminders') return { add: mockReminderAdd, where: mockReminderWhere }
    throw new Error(`Unexpected collection ${name}`)
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('Life OS reminders API route', () => {
  it('upserts opt-in preferences and lists scheduled reminders with org/owner scoping', async () => {
    const { GET, PATCH } = await import('@/app/api/v1/life-os/reminders/route')

    const patchRes = await PATCH(new NextRequest('http://localhost/api/v1/life-os/reminders', {
      method: 'PATCH',
      body: JSON.stringify({
        orgId: 'org-1',
        optedIn: true,
        channels: { inApp: true, push: true, email: false },
        quietHours: { start: '21:00', end: '07:00', timezone: 'Africa/Johannesburg' },
        enabledKinds: ['daily-check-in', 'habit-prompt', 'weekly-review', 'recovery-nudge'],
      }),
    }))
    const patchBody = await patchRes.json()

    expect(patchRes.status).toBe(200)
    expect(mockPreferencesDoc).toHaveBeenCalledWith('org-1:user-1')
    expect(mockPreferencesSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      ownerId: 'user-1',
      optedIn: true,
      consentUpdatedAt: '2026-06-15T05:45:00.000Z',
    }), { merge: true })
    expect(patchBody.data.channels.push).toBe(true)

    const getRes = await GET(new NextRequest('http://localhost/api/v1/life-os/reminders?orgId=org-1&ownerId=user-1'))
    const getBody = await getRes.json()

    expect(getRes.status).toBe(200)
    expect(getBody.data.preferences.optedIn).toBe(true)
    expect(getBody.data.reminders[0]).toMatchObject({ id: 'reminder-existing', kind: 'daily-check-in' })
    expect(mockReminderWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })

  it('schedules due reminder candidates only when preferences allow them', async () => {
    const { POST } = await import('@/app/api/v1/life-os/reminders/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/life-os/reminders', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        candidates: [
          {
            kind: 'daily-check-in',
            title: 'Daily check-in',
            body: 'Capture today.',
            localDate: '2026-06-15',
            preferredTime: '07:30',
            timezone: 'Africa/Johannesburg',
            target: { type: 'life-os-check-in', id: '2026-06-15' },
          },
        ],
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockReminderAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'daily-check-in',
      status: 'scheduled',
      channels: { inApp: true, push: true, email: false },
      scheduledFor: '2026-06-15T07:30:00.000+02:00',
    }))
    expect(body.data.created).toHaveLength(1)
  })
})
