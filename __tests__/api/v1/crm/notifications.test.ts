import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { callAsMember, seedOrgMember } from '../../../helpers/crm'

process.env.SESSION_COOKIE_NAME = '__session'

type NotificationFixture = {
  id: string
  orgId: string
  userId?: string | null
  status: 'unread' | 'read'
  createdAt: { toDate: () => Date }
}

function buildQueryChain(docs: NotificationFixture[]) {
  const chain: Record<string, jest.Mock> = {}
  chain.where = jest.fn().mockReturnValue(chain)
  chain.limit = jest.fn().mockReturnValue(chain)
  chain.get = jest.fn().mockResolvedValue({
    docs: docs.map((d) => ({
      id: d.id,
      ref: { id: d.id },
      data: () => d,
    })),
  })
  return chain
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  notifications: NotificationFixture[] = [],
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users')
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers')
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
    if (name === 'organizations')
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    if (name === 'notifications') return buildQueryChain(notifications)
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

describe('CRM notifications routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lists current-user and org-wide notifications without composite query filters', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(member, [
      { id: 'n-old', orgId: 'org-1', userId: 'uid-1', status: 'read', createdAt: { toDate: () => new Date('2026-01-01') } },
      { id: 'n-other', orgId: 'org-1', userId: 'uid-2', status: 'unread', createdAt: { toDate: () => new Date('2026-05-01') } },
      { id: 'n-org', orgId: 'org-1', userId: null, status: 'unread', createdAt: { toDate: () => new Date('2026-05-02') } },
      { id: 'n-new', orgId: 'org-1', userId: 'uid-1', status: 'unread', createdAt: { toDate: () => new Date('2026-05-03') } },
    ])

    const req = callAsMember(member, 'GET', '/api/v1/crm/notifications?limit=20')
    const { GET } = await import('@/app/api/v1/crm/notifications/route')
    const res = await GET(req as NextRequest)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.notifications.map((n: { id: string }) => n.id)).toEqual(['n-new', 'n-org', 'n-old'])
    expect(body.data.unreadCount).toBe(2)
  })

  it('marks current-user and org-wide unread notifications as read in memory', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    const update = jest.fn()
    const commit = jest.fn().mockResolvedValue(undefined)
    ;(adminDb.batch as jest.Mock).mockReturnValue({ update, commit })
    stageAuth(member, [
      { id: 'n-user', orgId: 'org-1', userId: 'uid-1', status: 'unread', createdAt: { toDate: () => new Date('2026-05-03') } },
      { id: 'n-org', orgId: 'org-1', userId: null, status: 'unread', createdAt: { toDate: () => new Date('2026-05-02') } },
      { id: 'n-read', orgId: 'org-1', userId: 'uid-1', status: 'read', createdAt: { toDate: () => new Date('2026-05-01') } },
      { id: 'n-other', orgId: 'org-1', userId: 'uid-2', status: 'unread', createdAt: { toDate: () => new Date('2026-05-04') } },
    ])

    const req = callAsMember(member, 'POST', '/api/v1/crm/notifications/mark-read')
    const { POST } = await import('@/app/api/v1/crm/notifications/mark-read/route')
    const res = await POST(req as NextRequest)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.updated).toBe(2)
    expect(update).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
