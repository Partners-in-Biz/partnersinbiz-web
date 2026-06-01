jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { GET } from '@/app/api/v1/analytics/sessions/route'
import { GET as GET_DETAIL } from '@/app/api/v1/analytics/sessions/[id]/route'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

process.env.AI_API_KEY = 'test-key'

function makeReq(url: string) {
  return new NextRequest(url, { headers: { authorization: 'Bearer test-key' } })
}

function mockCollection(col: string, docs: object[]) {
  const mockDocs = docs.map((d: any) => ({ id: d.id ?? 'sess-1', data: () => d }))
  ;(adminDb.collection as jest.Mock).mockImplementation((c: string) => {
    if (c === 'properties')
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            id: 'prop-1',
            data: () => ({ orgId: 'org-1', deleted: false }),
          }),
        }),
      }
    if (c === col)
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: mockDocs }),
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(
            docs[0]
              ? {
                  exists: true,
                  id: (docs[0] as any).id ?? 'sess-1',
                  data: () => docs[0],
                }
              : { exists: false, data: () => null },
          ),
        }),
      }
    return {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    }
  })
}

describe('GET /api/v1/analytics/sessions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 without auth', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/v1/analytics/sessions'),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when propertyId missing', async () => {
    mockCollection('product_sessions', [])
    const res = await GET(makeReq('http://localhost/api/v1/analytics/sessions'))
    expect(res.status).toBe(400)
  })

  it('returns sessions list', async () => {
    mockCollection('product_sessions', [
      { id: 's1', distinctId: 'anon_1', eventCount: 5 },
    ])
    const res = await GET(
      makeReq('http://localhost/api/v1/analytics/sessions?propertyId=prop-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

describe('GET /api/v1/analytics/sessions/:id', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns session with events', async () => {
    mockCollection('product_sessions', [{ id: 'sess-1', propertyId: 'prop-1', distinctId: 'anon_1' }])
    const ctx = { params: Promise.resolve({ id: 'sess-1' }) }
    const res = await GET_DETAIL(
      makeReq('http://localhost/api/v1/analytics/sessions/sess-1'),
      ctx,
    )
    expect(res.status).toBe(200)
  })

  it('returns 404 when session not found', async () => {
    mockCollection('product_sessions', [])
    const ctx = { params: Promise.resolve({ id: 'nonexistent' }) }
    const res = await GET_DETAIL(
      makeReq('http://localhost/api/v1/analytics/sessions/nonexistent'),
      ctx,
    )
    expect(res.status).toBe(404)
  })
})
