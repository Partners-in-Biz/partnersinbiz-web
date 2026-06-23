import { NextRequest } from 'next/server'

const mockConsumeMagicLink = jest.fn()
const mockFindOrCreateGuestUser = jest.fn()
const mockCreateCustomToken = jest.fn()
const mockMarkPendingLegalAcceptanceForLogin = jest.fn()

jest.mock('@/lib/client-documents/magicLink', () => ({
  consumeMagicLink: mockConsumeMagicLink,
}))

jest.mock('@/lib/auth/guestUser', () => ({
  findOrCreateGuestUser: mockFindOrCreateGuestUser,
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    createCustomToken: mockCreateCustomToken,
  },
}))

jest.mock('@/lib/governance/legal-acceptance', () => ({
  markPendingLegalAcceptanceForLogin: (...args: unknown[]) => mockMarkPendingLegalAcceptanceForLogin(...args),
}))

function getRequest(url: string) {
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateCustomToken.mockResolvedValue('mock-custom-token')
  mockMarkPendingLegalAcceptanceForLogin.mockResolvedValue(undefined)
  mockFindOrCreateGuestUser.mockResolvedValue({
    uid: 'user-1',
    email: 'foo@example.com',
  })
})

describe('GET /api/v1/auth/magic-link/verify', () => {
  it('redirects to error?reason=missing_token when no token', async () => {
    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify'))

    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/auth/magic-link/error?reason=missing_token')
    expect(mockConsumeMagicLink).not.toHaveBeenCalled()
  })

  it('redirects with reason=not_found when token does not exist', async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({ ok: false, reason: 'not_found' })

    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify?token=bad'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').toContain('reason=not_found')
    expect(mockFindOrCreateGuestUser).not.toHaveBeenCalled()
  })

  it('redirects with reason=expired when consume returns expired', async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({ ok: false, reason: 'expired' })

    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify?token=x'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').toContain('reason=expired')
  })

  it('redirects with reason=used when token already consumed', async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({ ok: false, reason: 'used' })

    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify?token=x'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').toContain('reason=used')
  })

  it('on success, mints custom token and redirects to landing page with redirect param', async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({
      ok: true,
      email: 'foo@example.com',
      redirectUrl: '/portal/documents/abc',
    })

    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify?token=good'))

    expect(res.status).toBe(307)
    expect(mockFindOrCreateGuestUser).toHaveBeenCalledWith('foo@example.com', 'magic_link')
    expect(mockCreateCustomToken).toHaveBeenCalledWith('user-1')
    expect(mockMarkPendingLegalAcceptanceForLogin).toHaveBeenCalledWith({
      uid: 'user-1',
      email: 'foo@example.com',
    })

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/auth/magic-link/verify')
    expect(location.searchParams.get('customToken')).toBe('mock-custom-token')
    expect(location.searchParams.get('redirect')).toBe('/portal/documents/abc')
  })

  it('defaults redirect to / when consumeMagicLink returns no redirectUrl', async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({
      ok: true,
      email: 'foo@example.com',
    })

    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify?token=good'))

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.searchParams.get('redirect')).toBe('/')
  })

  it('guards against missing email on ok=true (defensive)', async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({ ok: true })

    const { GET } = await import('@/app/api/v1/auth/magic-link/verify/route')
    const res = await GET(getRequest('http://localhost/api/v1/auth/magic-link/verify?token=good'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').toContain('reason=not_found')
    expect(mockFindOrCreateGuestUser).not.toHaveBeenCalled()
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })
})

export {}
