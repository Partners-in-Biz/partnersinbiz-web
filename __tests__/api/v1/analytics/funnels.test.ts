jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { GET, POST } from '@/app/api/v1/analytics/funnels/route'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

process.env.AI_API_KEY = 'test-key'

function makeReq(method: string, body?: object, search = '') {
  return new NextRequest(`http://localhost/api/v1/analytics/funnels${search}`, {
    method,
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function mockDb(docs: object[] = []) {
  const mockDocs = docs.map((d: any) => ({ id: (d as any).id ?? 'f1', data: () => d }))
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'properties') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            id: 'prop-1',
            data: () => ({ orgId: 'org-1', deleted: false }),
          }),
        }),
      }
    }
    return {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: mockDocs }),
      add: jest.fn().mockResolvedValue({ id: 'new-funnel' }),
    }
  })
}

describe('GET /api/v1/analytics/funnels', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 400 when propertyId missing', async () => {
    mockDb([])
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(400)
  })

  it('returns funnels list', async () => {
    mockDb([{ id: 'f1', name: 'My Funnel', steps: [] }])
    const res = await GET(makeReq('GET', undefined, '?propertyId=prop-1'))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/analytics/funnels', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a funnel', async () => {
    mockDb()
    const res = await POST(makeReq('POST', {
      propertyId: 'prop-1',
      name: 'Test Funnel',
      steps: [{ event: 'page_view' }, { event: 'test_started' }],
      window: '24h',
    }))
    expect(res.status).toBe(201)
  })

  it('returns 400 when steps < 2', async () => {
    mockDb()
    const res = await POST(makeReq('POST', {
      propertyId: 'prop-1',
      name: 'Bad Funnel',
      steps: [{ event: 'page_view' }],
      window: '24h',
    }))
    expect(res.status).toBe(400)
  })
})
