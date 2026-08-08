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

jest.mock('@/lib/research/designContextScanner', () => ({
  scanDesignFromUrl: jest.fn(),
}))

jest.mock('@/lib/research/store', () => ({
  upsertDesignContext: jest.fn(),
}))

const scannerMock = jest.requireMock('@/lib/research/designContextScanner')
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

describe('POST /api/v1/research/design-context/scan', () => {
  it('scans a public URL and upserts a style-scan design context', async () => {
    scannerMock.scanDesignFromUrl.mockResolvedValue({
      url: 'https://acme.example/',
      title: 'Acme Legal',
      palette: [{ name: 'primary', value: '#0F172A' }],
      typeStack: [{ role: 'heading', family: 'Fraunces' }],
      componentHints: [{ name: 'card', count: 3 }, { name: 'btn', count: 2 }],
      radiusScale: [{ name: 'radius-md', value: '8px' }],
      elevationScale: [{ name: 'elevation-md', value: '0 2px 8px rgba(0,0,0,0.1)' }],
      notes: ['Found 4 CSS custom properties'],
    })
    storeMock.upsertDesignContext.mockResolvedValue({ id: 'design-1', created: false, version: 2 })

    const { POST } = await import('@/app/api/v1/research/design-context/scan/route')
    const req = new NextRequest('http://localhost/api/v1/research/design-context/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        companyId: 'company-acme',
        url: 'https://acme.example/',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ id: 'design-1', created: false, version: 2 })
    expect(body.data.scan).toMatchObject({ url: 'https://acme.example/', title: 'Acme Legal' })
    expect(storeMock.upsertDesignContext).toHaveBeenCalledWith(expect.objectContaining({
      source: 'style-scan',
      sourceUrl: 'https://acme.example/',
      payload: expect.objectContaining({
        palette: expect.arrayContaining([{ name: 'primary', value: '#0F172A' }]),
        componentRules: expect.arrayContaining(['component .card (3 uses)', 'component .btn (2 uses)']),
      }),
    }))
  })

  it('rejects scanner failures with a clean 400', async () => {
    scannerMock.scanDesignFromUrl.mockRejectedValue(new Error('private, local, or metadata hosts are not allowed'))
    const { POST } = await import('@/app/api/v1/research/design-context/scan/route')
    const req = new NextRequest('http://localhost/api/v1/research/design-context/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', url: 'http://localhost:3000/' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/private/i)
  })

  it('requires a url', async () => {
    const { POST } = await import('@/app/api/v1/research/design-context/scan/route')
    const req = new NextRequest('http://localhost/api/v1/research/design-context/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('url is required')
  })
})
