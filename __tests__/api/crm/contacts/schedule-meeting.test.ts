import { NextRequest } from 'next/server'

const mockContactGet = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockCollection = jest.fn()

const contactRef = { id: 'contact-1', get: mockContactGet }
const eventRef = { id: 'event-1' }
const activityRef = { id: 'activity-1' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
}))

const ACTOR_REF = { uid: 'uid-tester', displayName: 'Tester', kind: 'human' as const }
const ORG_ID = 'org-abc'
type CrmHandler = (req: NextRequest, ctx: Record<string, unknown>, routeCtx?: unknown) => Promise<Response>

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth:
    (_minRole: string, handler: CrmHandler) =>
    (req: NextRequest, routeCtx?: unknown) =>
      handler(req, { orgId: ORG_ID, actor: ACTOR_REF, role: 'member', isAgent: false, permissions: {} }, routeCtx),
}))

function makeReq(body: unknown, contactId = 'contact-1') {
  return new NextRequest(`http://localhost/api/v1/crm/contacts/${contactId}/schedule-meeting`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeRouteCtx(id = 'contact-1') {
  return { params: Promise.resolve({ id }) }
}

function contactSnap(data: Record<string, unknown> | null) {
  return { exists: data !== null, data: () => data ?? undefined }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBatchCommit.mockResolvedValue(undefined)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'contacts') return { doc: jest.fn(() => contactRef) }
    if (name === 'calendar_events') return { doc: jest.fn(() => eventRef) }
    if (name === 'activities') return { doc: jest.fn(() => activityRef) }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('POST /api/v1/crm/contacts/:id/schedule-meeting', () => {
  it('creates a calendar event, logs activity, and updates the contact', async () => {
    mockContactGet.mockResolvedValue(contactSnap({
      orgId: ORG_ID,
      name: 'Ada Client',
      email: 'ada@example.com',
    }))

    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/schedule-meeting/route')
    const res = await POST(makeReq({
      title: 'Discovery call',
      startAt: '2026-05-19T08:00:00.000Z',
      endAt: '2026-05-19T08:30:00.000Z',
      meetingUrl: 'https://meet.example/abc',
    }), makeRouteCtx())

    expect(res.status).toBe(201)
    expect(mockBatchSet).toHaveBeenCalledTimes(2)
    expect(mockBatchUpdate).toHaveBeenCalledWith(contactRef, expect.objectContaining({
      lastContactedAt: expect.anything(),
    }))
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)

    const [eventWriteRef, eventWriteData] = mockBatchSet.mock.calls[0]
    expect(eventWriteRef).toBe(eventRef)
    expect(eventWriteData).toEqual(expect.objectContaining({
      orgId: ORG_ID,
      title: 'Discovery call',
      startAt: '2026-05-19T08:00:00.000Z',
      endAt: '2026-05-19T08:30:00.000Z',
      relatedTo: { type: 'contact', id: 'contact-1' },
      attendees: [{ name: 'Ada Client', email: 'ada@example.com', status: 'pending' }],
      createdBy: 'uid-tester',
      createdByType: 'user',
    }))

    const [, activityWriteData] = mockBatchSet.mock.calls[1]
    expect(activityWriteData).toEqual(expect.objectContaining({
      orgId: ORG_ID,
      contactId: 'contact-1',
      type: 'note',
      summary: 'Meeting scheduled: Discovery call',
      metadata: expect.objectContaining({
        calendarEventId: 'event-1',
        meetingUrl: 'https://meet.example/abc',
      }),
    }))
  })

  it('rejects invalid meeting windows', async () => {
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/schedule-meeting/route')
    const res = await POST(makeReq({
      startAt: '2026-05-19T08:30:00.000Z',
      endAt: '2026-05-19T08:00:00.000Z',
    }), makeRouteCtx())

    expect(res.status).toBe(400)
    expect(mockContactGet).not.toHaveBeenCalled()
  })

  it('hides contacts from other workspaces', async () => {
    mockContactGet.mockResolvedValue(contactSnap({
      orgId: 'other-org',
      email: 'ada@example.com',
    }))

    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/schedule-meeting/route')
    const res = await POST(makeReq({
      startAt: '2026-05-19T08:00:00.000Z',
      endAt: '2026-05-19T08:30:00.000Z',
    }), makeRouteCtx())

    expect(res.status).toBe(404)
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('requires an email address for the meeting attendee', async () => {
    mockContactGet.mockResolvedValue(contactSnap({ orgId: ORG_ID, name: 'No Email' }))

    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/schedule-meeting/route')
    const res = await POST(makeReq({
      startAt: '2026-05-19T08:00:00.000Z',
      endAt: '2026-05-19T08:30:00.000Z',
    }), makeRouteCtx())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })
})
