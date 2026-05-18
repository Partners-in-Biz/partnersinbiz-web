import { NextRequest } from 'next/server'

const mockVerifySessionCookie = jest.fn()
const mockUserGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: (cookie: string, checkRevoked?: boolean) =>
      mockVerifySessionCookie(cookie, checkRevoked),
  },
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: mockUserGet })),
    })),
  },
}))

process.env.SESSION_COOKIE_NAME = '__session'

describe('/api/auth/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1', email: 'token@example.com' })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        name: 'Restricted Admin',
        email: 'admin@example.com',
        allowedOrgIds: ['org-a'],
      }),
    })
  })

  it('returns the signed-in user email from the user mirror', async () => {
    const { GET } = await import('@/app/api/auth/verify/route')
    const req = new NextRequest('http://localhost/api/auth/verify')
    req.cookies.set('__session', 'session-cookie')

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('admin@example.com')
    expect(body.isSuperAdmin).toBe(false)
  })

  it('falls back to the decoded token email when the user mirror has no email', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', allowedOrgIds: [] }),
    })
    const { GET } = await import('@/app/api/auth/verify/route')
    const req = new NextRequest('http://localhost/api/auth/verify')
    req.cookies.set('__session', 'session-cookie')

    const res = await GET(req)
    const body = await res.json()
    expect(body.email).toBe('token@example.com')
    expect(body.isSuperAdmin).toBe(true)
  })
})
