import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()
let mockUser: MockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }
let organizationSettings: Record<string, unknown>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (requiredRole: 'admin' | 'client', handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => {
    const roleOk =
      mockUser.role === 'ai' ||
      mockUser.role === 'admin' ||
      (requiredRole === 'client' && mockUser.role === 'client')
    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler(req, mockUser, ctx)
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

jest.mock('@/lib/research/store', () => ({
  findDesignContextItem: jest.fn(),
  upsertDesignContext: jest.fn(),
}))

const storeMock = jest.requireMock('@/lib/research/store')

beforeEach(() => {
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }
  organizationSettings = {}
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ id: 'design-1', set: mockSet, update: mockUpdate, get: mockGet, collection: mockCollection })
  mockWhere.mockReturnValue({ get: mockGet })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          get: jest.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({ id, members: [], settings: organizationSettings }),
          }),
        })),
      }
    }
    return { doc: mockDoc, where: mockWhere, get: mockGet }
  })
})

describe('GET /api/v1/research/design-context', () => {
  it('returns found=false when no design context exists', async () => {
    storeMock.findDesignContextItem.mockResolvedValue(null)
    const { GET } = await import('@/app/api/v1/research/design-context/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/research/design-context?orgId=org-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ found: false, designContext: null })
  })

  it('returns the latest design context record', async () => {
    storeMock.findDesignContextItem.mockResolvedValue({
      id: 'design-1',
      title: 'Design Context — acme',
      updatedAt: { toMillis: () => 100 },
      designContext: { audience: 'Small law firms', version: 3, source: 'questionnaire', history: [] },
    })
    const { GET } = await import('@/app/api/v1/research/design-context/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/research/design-context?orgId=org-1&companyId=company-acme'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.found).toBe(true)
    expect(body.data.designContext.version).toBe(3)
    expect(storeMock.findDesignContextItem).toHaveBeenCalledWith('org-1', 'company-acme')
  })
})

describe('POST /api/v1/research/design-context (questionnaire)', () => {
  it('upserts a questionnaire design context and returns 201 on create', async () => {
    storeMock.upsertDesignContext.mockResolvedValue({ id: 'design-new', created: true, version: 1 })
    const { POST } = await import('@/app/api/v1/research/design-context/route')
    const req = new NextRequest('http://localhost/api/v1/research/design-context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        companyId: 'company-acme',
        audience: 'Small law firms',
        positioning: 'Modern trust',
        brandVoice: 'Clear, calm.',
        palette: [{ name: 'primary', value: '#0F172A' }],
        surfaceModes: [{ surface: 'landing', mode: 'persuade' }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(storeMock.upsertDesignContext).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      companyId: 'company-acme',
      source: 'questionnaire',
      payload: expect.objectContaining({ audience: 'Small law firms', positioning: 'Modern trust' }),
    }))
  })

  it('allows style-scan source passthrough', async () => {
    storeMock.upsertDesignContext.mockResolvedValue({ id: 'design-1', created: false, version: 2 })
    const { POST } = await import('@/app/api/v1/research/design-context/route')
    const req = new NextRequest('http://localhost/api/v1/research/design-context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        source: 'style-scan',
        sourceUrl: 'https://acme.example/',
        palette: [{ name: 'primary', value: '#0F172A' }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(storeMock.upsertDesignContext).toHaveBeenCalledWith(expect.objectContaining({ source: 'style-scan' }))
  })
})
