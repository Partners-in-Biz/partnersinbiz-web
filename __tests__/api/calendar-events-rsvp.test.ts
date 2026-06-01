import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }
const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockWithAuth = jest.fn((_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx))

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({ withAuth: mockWithAuth }))
jest.mock('@/lib/api/actor', () => ({ lastActorFrom: jest.fn(() => ({ updatedBy: 'client-1', updatedByType: 'user' })) }))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
  mockCollection.mockImplementation((name: string) => {
    if (name !== 'calendar_events') throw new Error(`Unexpected collection: ${name}`)
    return { doc: mockDoc }
  })
})

describe('calendar event RSVP route', () => {
  it('allows portal users to update their own pending RSVP on an accessible event', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'event-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Website retainer check-in',
        attendees: [{ name: 'Ava Owner', email: 'ava@example.test', status: 'pending' }],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/calendar/events/[id]/rsvp/route')
    expect(mockWithAuth).toHaveBeenCalledWith('client', expect.any(Function))

    const res = await POST(new NextRequest('http://localhost/api/v1/calendar/events/event-1/rsvp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ava@example.test', status: 'accepted' }),
    }), { params: Promise.resolve({ id: 'event-1' }) })

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      attendees: [{ name: 'Ava Owner', email: 'ava@example.test', status: 'accepted' }],
      updatedBy: 'client-1',
    }))
  })
})
