export {}

import { NextRequest } from 'next/server'

const mockBuildBriefingFeed = jest.fn()
const mockCreateBriefingSnapshot = jest.fn()
const mockUser = { uid: 'admin-1', role: 'admin' as const, allowedOrgIds: ['org-1'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockUser) => Promise<Response>) =>
    async (req: NextRequest) => handler(req, mockUser),
}))

jest.mock('@/lib/briefing/feed', () => ({
  buildBriefingFeed: mockBuildBriefingFeed,
  createBriefingSnapshot: mockCreateBriefingSnapshot,
}))

describe('briefing API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the authenticated briefing feed', async () => {
    mockBuildBriefingFeed.mockResolvedValue({ items: [], total: 0, pageSize: 40, hasMore: false, generatedAt: '2026-05-30T10:00:00.000Z', scope: { orgId: 'org-1' } })
    const { GET } = await import('@/app/api/v1/briefings/feed/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/briefings/feed?orgId=org-1&priority=critical&sourceType=task&limit=25'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
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
    expect(mockCreateBriefingSnapshot).toHaveBeenCalledWith(mockUser, {
      orgId: 'org-1',
      title: 'Snapshot',
      priority: 'all',
      sourceType: 'comment',
      limit: 12,
    })
  })
})
