import { GET } from '@/app/api/v1/analytics/live/route'
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

describe('GET /api/v1/analytics/live', () => {
  it('returns 400 when propertyId missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/live')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns events array', async () => {
    const mockQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [{
          id: 'e1',
          data: () => ({ event: 'pageview', distinctId: 'u1', serverTime: { toDate: () => new Date() } }),
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
    const req = new NextRequest('http://localhost/api/v1/analytics/live?propertyId=prop_x')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
  })
})
