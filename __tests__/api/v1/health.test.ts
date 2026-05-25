// __tests__/api/v1/health.test.ts
import { GET } from '@/app/api/v1/health/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
      }),
    }),
  },
}))

process.env.AI_API_KEY = 'test-key'

function makeReq() {
  return new NextRequest('http://localhost/api/v1/health', {
    headers: { authorization: 'Bearer test-key' },
  })
}

describe('GET /api/v1/health', () => {
  it('returns 200 with authenticated identity', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.ok).toBe(true)
    expect(body.data.services).toEqual({ auth: 'ok', api: 'ok', firestore: 'ok' })
    expect(body.data.identity.role).toBe('ai')
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/health')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
