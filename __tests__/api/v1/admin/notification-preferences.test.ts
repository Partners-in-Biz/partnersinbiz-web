import { NextRequest } from 'next/server'

const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockCollection = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_requiredRole: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any) => {
    if (user?.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler(req, user)
  },
}))

function request(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body ? 'PATCH' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDocGet.mockReset()
  mockDocSet.mockReset().mockResolvedValue(undefined)
  mockCollection.mockReturnValue({
    doc: jest.fn(() => ({ get: mockDocGet, set: mockDocSet })),
  })
})

describe('/api/v1/admin/notification-preferences', () => {
  it('returns default preferences when no durable record exists', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false })
    const { GET } = await import('@/app/api/v1/admin/notification-preferences/route')

    const res = await GET(request('http://localhost/api/v1/admin/notification-preferences?orgId=org-a'), {
      uid: 'admin-1',
      role: 'admin',
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.preference.userId).toBe('admin-1')
    expect(body.data.preference.orgId).toBe('org-a')
    expect(body.data.preference.eventClasses.client_acceptance).toEqual({ inApp: true, push: true, email: true })
    expect(mockCollection).toHaveBeenCalledWith('admin_notification_preferences')
  })

  it('forbids restricted admins from reading or writing preferences outside allowedOrgIds', async () => {
    const { GET, PATCH } = await import('@/app/api/v1/admin/notification-preferences/route')
    const restricted = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] }

    const getRes = await GET(request('http://localhost/api/v1/admin/notification-preferences?orgId=org-b'), restricted)
    const patchRes = await PATCH(
      request('http://localhost/api/v1/admin/notification-preferences?orgId=org-b', {
        eventClasses: { client_acceptance: { email: false } },
      }),
      restricted,
    )

    expect(getRes.status).toBe(403)
    expect(patchRes.status).toBe(403)
    expect(mockDocSet).not.toHaveBeenCalled()
  })

  it('persists channel and event-class updates for the current admin and client workspace', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        userId: 'admin-1',
        orgId: 'org-a',
        channels: { inApp: true, push: true, email: true },
        eventClasses: { client_acceptance: { inApp: true, push: true, email: true } },
      }),
    })
    const { PATCH } = await import('@/app/api/v1/admin/notification-preferences/route')

    const res = await PATCH(
      request('http://localhost/api/v1/admin/notification-preferences?orgId=org-a', {
        channels: { inApp: true, push: false, email: true },
        eventClasses: { client_acceptance: { inApp: true, push: false, email: false } },
      }),
      { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.preference.eventClasses.client_acceptance).toEqual({ inApp: true, push: false, email: false })
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        orgId: 'org-a',
        channels: { inApp: true, push: false, email: true },
        eventClasses: expect.objectContaining({ client_acceptance: { inApp: true, push: false, email: false } }),
        updatedBy: 'admin-1',
        updatedByType: 'user',
        updatedAt: 'server-timestamp',
      }),
      { merge: true },
    )
  })
})

export {}
