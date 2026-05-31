import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockData = jest.fn()
const mockWithAuthCalls: string[] = []
const mockUser = { uid: 'client-1', role: 'client' as const, orgIds: ['org-1'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (role: string, handler: (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>) => {
    mockWithAuthCalls.push(role)
    return async (req: NextRequest, context?: unknown) => handler(req, mockUser, context)
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: mockGet,
        update: mockUpdate,
      })),
    })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

describe('notification item route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWithAuthCalls.length = 0
    mockData.mockReturnValue({ orgId: 'org-1', status: 'unread' })
    mockGet.mockResolvedValue({ exists: true, id: 'notification-1', data: mockData })
  })

  it('lets an authenticated client mark an accessible org notification read', async () => {
    const { PATCH } = await import('@/app/api/v1/notifications/[id]/route')

    const res = await PATCH(new NextRequest('http://localhost/api/v1/notifications/notification-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'read' }),
    }), { params: Promise.resolve({ id: 'notification-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockWithAuthCalls).toContain('client')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'read',
      readAt: 'server-timestamp',
    }))
  })

  it('blocks clients from updating notifications outside their organisations', async () => {
    mockData.mockReturnValue({ orgId: 'org-2', status: 'unread' })
    const { PATCH } = await import('@/app/api/v1/notifications/[id]/route')

    const res = await PATCH(new NextRequest('http://localhost/api/v1/notifications/notification-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'read' }),
    }), { params: Promise.resolve({ id: 'notification-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/forbidden/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
