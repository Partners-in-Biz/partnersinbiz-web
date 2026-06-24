import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockLimit = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockSubCollection = jest.fn()
const mockSubDoc = jest.fn()
const mockVersionGet = jest.fn()

const mockVerifySessionCookie = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  adminAuth: { verifySessionCookie: (...args: unknown[]) => mockVerifySessionCookie(...args) },
}))

const TOKEN = 'b'.repeat(32)

function getRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { method: 'GET', headers })
}

function buildCookieHeader(parts: Record<string, string>) {
  return Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function configureDocLookup(result: {
  empty: boolean
  doc?: {
    id: string
    data: Record<string, unknown>
  }
  // Only set version mocks when the route is expected to reach the version `.get()`,
  // i.e. doc was found, editShareEnabled=true, deleted=false, and currentVersionId set.
  // Otherwise carry-over from previous tests can poison later assertions.
  version?: { exists: false } | { exists: true; id?: string; data?: Record<string, unknown> }
}) {
  // First call: `.collection('client_documents').where().limit().get()` for the doc lookup.
  mockGet.mockImplementationOnce(async () => {
    if (result.empty) return { empty: true, docs: [] }
    const d = result.doc!
    return {
      empty: false,
      docs: [
        {
          id: d.id,
          data: () => d.data,
        },
      ],
    }
  })

  if (result.version) {
    if (result.version.exists === false) {
      mockVersionGet.mockImplementationOnce(async () => ({ exists: false }))
    } else {
      const versionId = result.version.id ?? 'v-1'
      const versionData = result.version.data ?? { body: 'v1' }
      mockVersionGet.mockImplementationOnce(async () => ({
        exists: true,
        id: versionId,
        data: () => versionData,
      }))
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  // Shared chainable query for the docs lookup.
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)

  // versions sub-doc: .doc(id).collection('versions').doc(versionId).get()
  mockSubDoc.mockReturnValue({ get: mockVersionGet })
  mockSubCollection.mockReturnValue({ doc: mockSubDoc })
  mockDoc.mockReturnValue({ collection: mockSubCollection })

  // Top-level collection returns either the chainable query (for where()) or the doc accessor (for doc(id)).
  mockCollection.mockReturnValue({
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
    doc: mockDoc,
  })

  mockVerifySessionCookie.mockResolvedValue({ uid: 'user-1', email: 'foo@example.com' })
})

describe('GET /api/v1/public/client-documents/edit/[editShareToken]', () => {
  // Helper: a document that requires an access code (editAccessCode set).
  function codeProtectedDoc(extra: Record<string, unknown> = {}) {
    return {
      empty: false as const,
      doc: {
        id: 'doc-1',
        data: {
          editShareEnabled: true,
          deleted: false,
          currentVersionId: 'v-1',
          editAccessCode: '123456',
          ...extra,
        },
      },
    }
  }

  // Helper: a document that does NOT require an access code.
  function openDoc(extra: Record<string, unknown> = {}) {
    return {
      empty: false as const,
      doc: {
        id: 'doc-1',
        data: {
          editShareEnabled: true,
          deleted: false,
          currentVersionId: 'v-1',
          ...extra,
        },
      },
    }
  }

  it('returns 401 "Code verification required" when no code cookie present (code-protected doc)', async () => {
    // The route now loads the document first (US-036): the access code is only
    // required when the document actually configures one.
    configureDocLookup(codeProtectedDoc())

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`)
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Code verification required')
    expect(mockVerifySessionCookie).not.toHaveBeenCalled()
    // Doc lookup runs before the code check now.
    expect(mockWhere).toHaveBeenCalledWith('editShareToken', '==', TOKEN)
  })

  it('returns 401 "Sign-in required" when code cookie present but no session cookie', async () => {
    configureDocLookup(codeProtectedDoc())

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Sign-in required')
    expect(mockVerifySessionCookie).not.toHaveBeenCalled()
  })

  it('returns 401 when session cookie is invalid (verifySessionCookie throws)', async () => {
    configureDocLookup(codeProtectedDoc())
    mockVerifySessionCookie.mockRejectedValueOnce(new Error('invalid session'))

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1', __session: 'bad-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Sign-in required')
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('bad-session', true)
  })

  it('returns 404 when no document matches the editShareToken', async () => {
    configureDocLookup({ empty: true })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1', __session: 'good-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(404)
    expect(mockWhere).toHaveBeenCalledWith('editShareToken', '==', TOKEN)
  })

  it('returns 410 when edit-share is disabled on the document', async () => {
    configureDocLookup({
      empty: false,
      doc: {
        id: 'doc-1',
        data: {
          editShareEnabled: false,
          deleted: false,
          currentVersionId: 'v-1',
        },
      },
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1', __session: 'good-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('Link disabled')
  })

  it('returns 410 when the document is soft-deleted', async () => {
    configureDocLookup({
      empty: false,
      doc: {
        id: 'doc-1',
        data: {
          editShareEnabled: true,
          deleted: true,
          currentVersionId: 'v-1',
        },
      },
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1', __session: 'good-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(410)
  })

  it('returns 500 when the current version is missing', async () => {
    configureDocLookup({
      empty: false,
      doc: {
        id: 'doc-1',
        data: {
          editShareEnabled: true,
          deleted: false,
          currentVersionId: 'v-missing',
        },
      },
      version: { exists: false },
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1', __session: 'good-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(500)
  })

  it('returns 200 with document + version + user when both cookies are valid', async () => {
    configureDocLookup({
      empty: false,
      doc: {
        id: 'doc-9',
        data: {
          orgId: 'org-1',
          editShareEnabled: true,
          deleted: false,
          currentVersionId: 'v-7',
          title: 'Sample Proposal',
        },
      },
      version: { exists: true, id: 'v-7', data: { body: { text: 'Proposal contents' } } },
    })

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: '1', __session: 'good-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.document).toMatchObject({
      id: 'doc-9',
      title: 'Sample Proposal',
      editShareEnabled: true,
      currentVersionId: 'v-7',
    })
    expect(body.data.version).toMatchObject({
      id: 'v-7',
      body: { text: 'Proposal contents' },
    })
    expect(body.data.user).toEqual({ uid: 'user-1', email: 'foo@example.com' })

    expect(mockVerifySessionCookie).toHaveBeenCalledWith('good-session', true)
    expect(mockDoc).toHaveBeenCalledWith('doc-9')
    expect(mockSubCollection).toHaveBeenCalledWith('versions')
    expect(mockSubDoc).toHaveBeenCalledWith('v-7')
  })

  it('rejects a code cookie that is not exactly "1" on a code-protected doc', async () => {
    configureDocLookup(codeProtectedDoc())

    const { GET } = await import('@/app/api/v1/public/client-documents/edit/[editShareToken]/route')
    const req = getRequest(`http://localhost/api/v1/public/client-documents/edit/${TOKEN}`, {
      Cookie: buildCookieHeader({ [`eds_${TOKEN}`]: 'maybe', __session: 'good-session' }),
    })
    const res = await GET(req, { params: Promise.resolve({ editShareToken: TOKEN }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Code verification required')
  })
})

export {}
