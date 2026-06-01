import { GET } from '@/app/api/v1/analytics/retention/route'
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

describe('GET /api/v1/analytics/retention', () => {
  it('returns 400 when propertyId missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/retention')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when from/to missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/retention?propertyId=prop_x&cohortEvent=signup')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid date', async () => {
    const req = new NextRequest('http://localhost/api/v1/analytics/retention?propertyId=prop_x&cohortEvent=signup&from=bad&to=2026-05-01')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns retention result with empty rows when no events', async () => {
    const mockQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
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
    const req = new NextRequest(
      'http://localhost/api/v1/analytics/retention?propertyId=prop_x&cohortEvent=signup&returnEvent=pageview&from=2026-04-01&to=2026-04-30'
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.rows).toHaveLength(0)
  })
})
