// __tests__/api/portal-middleware.test.ts
import { NextRequest } from 'next/server'

const mockVerifySessionCookie = jest.fn()
const originalSessionCookieName = process.env.SESSION_COOKIE_NAME

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: mockVerifySessionCookie },
}))

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.SESSION_COOKIE_NAME
})

afterAll(() => {
  if (originalSessionCookieName === undefined) {
    delete process.env.SESSION_COOKIE_NAME
  } else {
    process.env.SESSION_COOKIE_NAME = originalSessionCookieName
  }
})

describe('withPortalAuth', () => {
  it('returns 401 when no session cookie', async () => {
    jest.resetModules()
    const { withPortalAuth } = await import('@/lib/auth/portal-middleware')
    const handler = jest.fn()
    const wrapped = withPortalAuth(handler)
    const req = new NextRequest('http://localhost/api/v1/portal/enquiries')
    const res = await wrapped(req)
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls handler with uid on valid session', async () => {
    jest.resetModules()
    mockVerifySessionCookie.mockResolvedValue({ uid: 'user-1' })
    const { withPortalAuth } = await import('@/lib/auth/portal-middleware')
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const wrapped = withPortalAuth(handler)
    const req = new NextRequest('http://localhost/api/v1/portal/enquiries', {
      headers: { Cookie: '__session=valid-cookie' },
    })
    const res = await wrapped(req)
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('valid-cookie', true)
    expect(handler).toHaveBeenCalledWith(req, 'user-1')
    expect(res.status).toBe(200)
  })

  it('honors the configured session cookie name', async () => {
    jest.resetModules()
    process.env.SESSION_COOKIE_NAME = 'pib_session'
    mockVerifySessionCookie.mockResolvedValue({ uid: 'user-1' })
    const { withPortalAuth } = await import('@/lib/auth/portal-middleware')
    const handler = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const wrapped = withPortalAuth(handler)
    const req = new NextRequest('http://localhost/api/v1/portal/enquiries', {
      headers: { Cookie: 'pib_session=valid-cookie' },
    })
    const res = await wrapped(req)
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('valid-cookie', true)
    expect(handler).toHaveBeenCalledWith(req, 'user-1')
    expect(res.status).toBe(200)
  })

  it('returns 401 when session cookie is invalid', async () => {
    jest.resetModules()
    mockVerifySessionCookie.mockRejectedValue(new Error('invalid'))
    const { withPortalAuth } = await import('@/lib/auth/portal-middleware')
    const handler = jest.fn()
    const wrapped = withPortalAuth(handler)
    const req = new NextRequest('http://localhost/api/v1/portal/enquiries', {
      headers: { Cookie: '__session=bad-cookie' },
    })
    const res = await wrapped(req)
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })
})
