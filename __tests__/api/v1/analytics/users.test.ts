import { GET as listUsers } from '@/app/api/v1/analytics/users/route'
import { GET as getUser, DELETE as deleteUser } from '@/app/api/v1/analytics/users/[distinctId]/route'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: unknown, ctx?: unknown) =>
    handler(req, { uid: 'admin-1', role: 'admin', authKind: 'session' }, ctx),
}))
jest.mock('@/lib/api/response', () => ({
  apiSuccess: (data: unknown) => Response.json(data),
  apiError: (msg: string, status: number) => Response.json({ error: msg }, { status }),
}))

type RouteContext = { params: Promise<{ distinctId: string }> }

describe('GET /api/v1/analytics/users', () => {
  it('returns 400 when propertyId missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/users')
    const res = await listUsers(req)
    expect(res.status).toBe(400)
  })

  it('returns users list', async () => {
    const mockQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [{
          id: 'evt1',
          data: () => ({
            distinctId: 'u-abc', userId: null,
            serverTime: { toDate: () => new Date('2026-04-01') },
          }),
        }],
      }),
    }
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'properties') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: true,
              id: 'prop_x',
              data: () => ({ orgId: 'org-1', deleted: false }),
            }),
          }),
        }
      }
      return mockQuery
    })
    const req = new NextRequest('http://localhost/api/v1/analytics/users?propertyId=prop_x')
    const res = await listUsers(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
    expect(body.users[0].distinctId).toBe('u-abc')
    expect(body.users[0].eventCount).toBe(1)
  })
})

describe('GET /api/v1/analytics/users/[distinctId]', () => {
  it('returns 400 when propertyId missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/users/u-abc')
    const ctx: RouteContext = { params: Promise.resolve({ distinctId: 'u-abc' }) }
    const res = await getUser(req, ctx as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when no events found', async () => {
    const mockQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [], empty: true }),
    }
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'properties') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: true,
              id: 'prop_x',
              data: () => ({ orgId: 'org-1', deleted: false }),
            }),
          }),
        }
      }
      return mockQuery
    })
    const req = new NextRequest('http://localhost/api/v1/analytics/users/u-abc?propertyId=prop_x')
    const ctx: RouteContext = { params: Promise.resolve({ distinctId: 'u-abc' }) }
    const res = await getUser(req, ctx as any)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/analytics/users/[distinctId]', () => {
  it('returns 400 when propertyId missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/users/u-abc', { method: 'DELETE' })
    const ctx: RouteContext = { params: Promise.resolve({ distinctId: 'u-abc' }) }
    const res = await deleteUser(req, ctx as any)
    expect(res.status).toBe(400)
  })
})
