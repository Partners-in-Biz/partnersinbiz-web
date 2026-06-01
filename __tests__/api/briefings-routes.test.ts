export {}

import { NextRequest } from 'next/server'

const mockBuildBriefingFeed = jest.fn()
const mockCreateBriefingSnapshot = jest.fn()
const mockStateSet = jest.fn()
const mockUser = { uid: 'admin-1', role: 'admin' as const, allowedOrgIds: ['org-1'] }
const mockRoles: string[] = []

jest.mock('@/lib/api/auth', () => ({
  withAuth: (role: string, handler: (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>) => {
    mockRoles.push(role)
    return async (req: NextRequest, context?: unknown) => handler(req, mockUser, context)
  },
}))

jest.mock('@/lib/briefing/feed', () => ({
  buildBriefingFeed: mockBuildBriefingFeed,
  createBriefingSnapshot: mockCreateBriefingSnapshot,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
  Timestamp: { fromMillis: jest.fn((ms: number) => ({ ms, toDate: () => new Date(ms) })) },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ set: mockStateSet })),
    })),
  },
}))

describe('briefing API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRoles.length = 0
  })

  it('returns the authenticated briefing feed', async () => {
    mockBuildBriefingFeed.mockResolvedValue({ items: [], total: 0, pageSize: 40, hasMore: false, generatedAt: '2026-05-30T10:00:00.000Z', scope: { orgId: 'org-1' } })
    const { GET } = await import('@/app/api/v1/briefings/feed/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/briefings/feed?orgId=org-1&priority=critical&sourceType=task&limit=25'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockRoles).toContain('client')
    expect(mockBuildBriefingFeed).toHaveBeenCalledWith(mockUser, {
      orgId: 'org-1',
      priority: 'critical',
      sourceType: 'task',
      limit: 25,
    })
  })

  it('saves a briefing snapshot report', async () => {
    mockCreateBriefingSnapshot.mockResolvedValue({ id: 'snapshot-1', orgId: 'org-1', title: 'Snapshot' })
    const { POST } = await import('@/app/api/v1/briefings/reports/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', title: 'Snapshot', sourceType: 'comment', limit: 12 }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.snapshot.id).toBe('snapshot-1')
    expect(mockRoles).toContain('client')
    expect(mockCreateBriefingSnapshot).toHaveBeenCalledWith(mockUser, {
      orgId: 'org-1',
      title: 'Snapshot',
      priority: 'all',
      sourceType: 'comment',
      limit: 12,
    })
  })

  it('persists per-user handled and snooze state for briefing cards', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/state/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/task%3A1/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'snoozed', snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(), note: 'Later' }),
    }), { params: Promise.resolve({ itemId: 'task%3A1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ itemId: 'task:1', status: 'snoozed' })
    expect(mockRoles).toContain('client')
    expect(mockStateSet).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'task:1',
      userId: 'admin-1',
      status: 'snoozed',
      note: 'Later',
    }), { merge: true })
  })
})
