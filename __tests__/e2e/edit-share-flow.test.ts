import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockDocumentGet = jest.fn()
const mockDocumentUpdate = jest.fn()
const mockQueryGet = jest.fn()
const mockQueryWhere = jest.fn()
const mockQueryLimit = jest.fn()
const mockSubCollection = jest.fn()
const mockSubDoc = jest.fn()
const mockVersionGet = jest.fn()
const mockOrgMemberGet = jest.fn()
const mockUserGet = jest.fn()

const mockVerifySessionCookie = jest.fn()
const mockCheckAndIncrementRateLimit = jest.fn()
const mockLogDocumentAccess = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
  adminAuth: { verifySessionCookie: (...args: unknown[]) => mockVerifySessionCookie(...args) },
}))

jest.mock('@/lib/rateLimit', () => ({
  checkAndIncrementRateLimit: (...args: unknown[]) => mockCheckAndIncrementRateLimit(...args),
}))

jest.mock('@/lib/client-documents/editShare', () => ({
  ...jest.requireActual('@/lib/client-documents/editShare'),
  logDocumentAccess: (...args: unknown[]) => mockLogDocumentAccess(...args),
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (requiredRole: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any, ctx?: any) => {
    const roleOk =
      user?.role === 'ai' || user?.role === 'admin' || (requiredRole === 'client' && user?.role === 'client')
    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler(req, user, ctx)
  },
}))

const adminUser = { uid: 'admin-1', role: 'admin' as const }

function postRequest(url: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: 'POST',
    body: body == null ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  })
}

function getRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { method: 'GET', headers })
}

function buildCookieHeader(parts: Record<string, string>) {
  return Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function extractEdsCookie(setCookie: string | null, token: string): string | null {
  if (!setCookie) return null
  const match = new RegExp(`eds_${token}=([^;]+)`).exec(setCookie)
  return match ? match[1] : null
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDocumentGet.mockReset()
  mockDocumentUpdate.mockReset().mockResolvedValue(undefined)
  mockQueryGet.mockReset()
  mockVersionGet.mockReset()

  const query = { where: mockQueryWhere, limit: mockQueryLimit, get: mockQueryGet }
  mockQueryWhere.mockReturnValue(query)
  mockQueryLimit.mockReturnValue(query)

  mockSubDoc.mockReturnValue({ get: mockVersionGet })
  mockSubCollection.mockReturnValue({ doc: mockSubDoc })

  const docRef = {
    id: 'doc-1',
    get: mockDocumentGet,
    update: mockDocumentUpdate,
    collection: mockSubCollection,
  }

  mockOrgMemberGet.mockResolvedValue({ exists: true, data: () => ({ status: 'active' }) })
  mockUserGet.mockResolvedValue({ exists: false, data: () => ({}) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'orgMembers') {
      return { doc: jest.fn(() => ({ get: mockOrgMemberGet })) }
    }
    if (name === 'users') {
      return { doc: jest.fn(() => ({ get: mockUserGet })) }
    }
    return {
      where: mockQueryWhere,
      limit: mockQueryLimit,
      get: mockQueryGet,
      doc: jest.fn(() => docRef),
    }
  })

  mockCheckAndIncrementRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 4,
    resetAt: new Date(Date.now() + 15 * 60 * 1000),
  })
  mockLogDocumentAccess.mockResolvedValue(undefined)
  mockVerifySessionCookie.mockResolvedValue({ uid: 'user-1', email: 'guest@example.com' })
})

describe('E2E: edit-share enable → verify-code → fetch', () => {
  it('1. admin enable returns 32-hex editShareToken and 6-char editAccessCode', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ orgId: 'org-1', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/edit-share/enable/route')
    const req = postRequest('http://localhost/api/v1/client-documents/doc-1/edit-share/enable', {})
    const res = await POST(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.editShareToken).toMatch(/^[0-9a-f]{32}$/)
    expect(body.data.editAccessCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(body.data.editShareEnabled).toBe(true)
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        editShareEnabled: true,
        editShareToken: body.data.editShareToken,
        editAccessCode: body.data.editAccessCode,
      }),
    )
  })

  it('2. verify-code with correct code returns 200 + sets eds_{token} cookie', async () => {
    const token = 'b'.repeat(32)
    const code = 'GOOD12'

    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-9',
          ref: { id: 'doc-9' },
          data: () => ({ editShareEnabled: true, editAccessCode: code, deleted: false }),
        },
      ],
    })

    const { POST } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/verify-code/route')
    const req = postRequest(
      `http://localhost/api/v1/public/client-documents/edit/${token}/verify-code`,
      { code },
      { 'x-forwarded-for': '1.2.3.4' },
    )
    const res = await POST(req, { params: Promise.resolve({ editShareToken: token }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { codeAccepted: true } })

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(extractEdsCookie(setCookie, token)).toBe('1')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toMatch(/SameSite=lax/i)
  })

  it('3. verify-code with wrong code returns 401 and no cookie is set', async () => {
    const token = 'c'.repeat(32)

    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-7',
          ref: { id: 'doc-7' },
          data: () => ({ editShareEnabled: true, editAccessCode: 'CORRECT', deleted: false }),
        },
      ],
    })

    const { POST } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/verify-code/route')
    const req = postRequest(
      `http://localhost/api/v1/public/client-documents/edit/${token}/verify-code`,
      { code: 'WRONG!' },
      { 'x-forwarded-for': '9.9.9.9' },
    )
    const res = await POST(req, { params: Promise.resolve({ editShareToken: token }) })

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(mockLogDocumentAccess).toHaveBeenCalledWith(
      'doc-7',
      expect.objectContaining({ type: 'code_failed' }),
    )
  })

  it('4. fetch doc with no cookies returns 401 "Code verification required"', async () => {
    const token = 'd'.repeat(32)

    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-4',
          ref: { id: 'doc-4' },
          data: () => ({ editShareEnabled: true, editAccessCode: 'CODE12', deleted: false, currentVersionId: 'v-1', linked: { clientOrgId: 'client-org' } }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${token}`)
    const res = await GET(req, { params: Promise.resolve({ editShareToken: token }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Code verification required')
    expect(mockVerifySessionCookie).not.toHaveBeenCalled()
  })

  it('5. fetch doc with code cookie but no session returns 401 "Sign-in required"', async () => {
    const token = 'e'.repeat(32)

    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-5',
          ref: { id: 'doc-5' },
          data: () => ({ editShareEnabled: true, editAccessCode: 'CODE12', deleted: false, currentVersionId: 'v-1', linked: { clientOrgId: 'client-org' } }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${token}`, {
      Cookie: buildCookieHeader({ [`eds_${token}`]: '1' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: token }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Sign-in required')
    expect(mockVerifySessionCookie).not.toHaveBeenCalled()
  })

  it('6. fetch doc with both cookies + valid session returns 200 with sanitized document, version, user', async () => {
    const token = 'f'.repeat(32)

    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-42',
          data: () => ({
            orgId: 'org-1',
            editShareEnabled: true,
            deleted: false,
            currentVersionId: 'v-3',
            title: 'A Real Proposal',
            linked: { clientOrgId: 'client-org' },
            editAccessCode: 'SECRET1',
          }),
        },
      ],
    })
    mockVersionGet.mockResolvedValueOnce({
      exists: true,
      id: 'v-3',
      data: () => ({ blocks: [{ id: 'hero', type: 'hero', content: 'sub' }] }),
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${token}`, {
      Cookie: buildCookieHeader({ [`eds_${token}`]: '1', __session: 'valid-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: token }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.document).toMatchObject({
      id: 'doc-42',
      title: 'A Real Proposal',
      currentVersionId: 'v-3',
    })
    expect(body.data.document.editShareEnabled).toBeUndefined()
    expect(body.data.document.editAccessCode).toBeUndefined()
    expect(body.data.version).toMatchObject({
      id: 'v-3',
      blocks: expect.any(Array),
    })
    expect(body.data.user).toEqual({ uid: 'user-1', email: 'guest@example.com' })
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('valid-session', true)
  })

  it('7. fetch doc when editShareEnabled=false returns 410 "Link disabled"', async () => {
    const token = 'a'.repeat(32)

    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-revoked',
          data: () => ({
            orgId: 'org-1',
            editShareEnabled: false,
            deleted: false,
            currentVersionId: 'v-1',
          }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${token}`, {
      Cookie: buildCookieHeader({ [`eds_${token}`]: '1', __session: 'valid-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: token }) })

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('Link disabled')
    expect(mockVersionGet).not.toHaveBeenCalled()
  })
})

export {}
