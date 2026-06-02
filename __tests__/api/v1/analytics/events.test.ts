jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { GET } from '@/app/api/v1/analytics/events/route'
import { GET as COUNT } from '@/app/api/v1/analytics/events/count/route'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

process.env.AI_API_KEY = 'test-key'

function makeReq(search: string) {
  return new NextRequest(`http://localhost/api/v1/analytics/events${search}`, {
    headers: { authorization: 'Bearer test-key' },
  })
}

function mockEvents(docs: object[]) {
  const mockDocs = docs.map((d: any) => ({ id: d.id ?? 'evt-1', data: () => d }))
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
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: mockDocs }),
    }
  })
}

function mockMissingProperty() {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'properties') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      }
    }
    return {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    }
  })
}

describe('GET /api/v1/analytics/events', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 without auth', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/analytics/events'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when propertyId missing', async () => {
    mockEvents([])
    const res = await GET(makeReq(''))
    expect(res.status).toBe(400)
  })

  it('returns events list', async () => {
    mockEvents([{ id: 'e1', event: 'test_started', distinctId: 'anon_1' }])
    const res = await GET(makeReq('?propertyId=prop-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('rejects unknown property ids before querying events', async () => {
    mockMissingProperty()
    const res = await GET(makeReq('?propertyId=prop-missing'))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/analytics/events/count', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 400 when propertyId missing', async () => {
    mockEvents([])
    const res = await COUNT(new NextRequest('http://localhost/api/v1/analytics/events/count', {
      headers: { authorization: 'Bearer test-key' },
    }))
    expect(res.status).toBe(400)
  })

  it('returns grouped counts', async () => {
    mockEvents([
      { event: 'test_started' },
      { event: 'test_started' },
      { event: 'share_clicked' },
    ])
    const res = await COUNT(makeReq('?propertyId=prop-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.groups).toBeDefined()
  })
})
