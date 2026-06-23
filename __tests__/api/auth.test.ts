// __tests__/api/auth.test.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'

const mockGetMaintenanceState = jest.fn()
const mockIsMaintenanceActiveNow = jest.fn()
const mockRequestBypassesMaintenance = jest.fn()

// Mock firebase admin
jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn(),
      }),
    }),
  },
}))

jest.mock('@/lib/governance/maintenance', () => ({
  getMaintenanceState: (...args: unknown[]) => mockGetMaintenanceState(...args),
  isMaintenanceActiveNow: (...args: unknown[]) => mockIsMaintenanceActiveNow(...args),
  requestBypassesMaintenance: (...args: unknown[]) => mockRequestBypassesMaintenance(...args),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v1/test', {
    headers: new Headers(headers),
  })
}

const handler = withAuth('admin', async (_req, user) => {
  return apiSuccess({ uid: user.uid, role: user.role })
})

beforeEach(() => {
  mockGetMaintenanceState.mockResolvedValue({ enabled: false, message: '', ipAllowlist: [] })
  mockIsMaintenanceActiveNow.mockReturnValue(false)
  mockRequestBypassesMaintenance.mockReturnValue(false)
})

describe('withAuth — maintenance enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetMaintenanceState.mockResolvedValue({ enabled: true, message: 'Scheduled maintenance', ipAllowlist: [] })
    mockIsMaintenanceActiveNow.mockReturnValue(true)
    ;(adminAuth.verifyIdToken as jest.Mock).mockResolvedValue({ uid: 'client-user' })
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client' }),
    })
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: mockGet }),
    })
  })

  it('blocks client API access with 503 while maintenance is active', async () => {
    const clientHandler = withAuth('client', async () => apiSuccess({ ok: true }))
    const req = makeReq({ authorization: 'Bearer valid-id-token' })

    const res = await clientHandler(req)

    expect(res.status).toBe(503)
  })
})

describe('withAuth — AI_API_KEY', () => {
  it('grants access with valid AI_API_KEY and returns role "ai"', async () => {
    const req = makeReq({ authorization: `Bearer ${AI_API_KEY}` })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.role).toBe('ai')
  })
})

describe('withAuth — Firebase ID token', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(adminAuth.verifyIdToken as jest.Mock).mockResolvedValue({ uid: 'user-123' })
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin' }),
    })
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: mockGet }),
    })
  })

  it('grants access when token is valid and role matches', async () => {
    const req = makeReq({ authorization: 'Bearer valid-id-token' })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.uid).toBe('user-123')
  })

  it('returns 403 when role is client but admin is required', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client' }),
    })
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: mockGet }),
    })
    const req = makeReq({ authorization: 'Bearer valid-id-token' })
    const res = await handler(req)
    expect(res.status).toBe(403)
  })
})

describe('withAuth — role hierarchy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(adminAuth.verifyIdToken as jest.Mock).mockResolvedValue({ uid: 'user-456' })
  })

  it('admin can access client-required routes', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin' }),
    })
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: mockGet }),
    })
    const clientHandler = withAuth('client', async (_req, user) => apiSuccess({ role: user.role }))
    const req = makeReq({ authorization: 'Bearer valid-id-token' })
    const res = await clientHandler(req)
    expect(res.status).toBe(200)
  })

  it('client cannot access admin-required routes', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client' }),
    })
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: mockGet }),
    })
    const req = makeReq({ authorization: 'Bearer valid-id-token' })
    const res = await handler(req)
    expect(res.status).toBe(403)
  })
})

describe('withAuth — unauthenticated', () => {
  it('returns 401 with no token and no cookie', async () => {
    const req = makeReq()
    const res = await handler(req)
    expect(res.status).toBe(401)
  })
})

describe('withAuth — session cookie', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: 'cookie-user' })
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin' }),
    })
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: mockGet }),
    })
  })

  it('grants access via session cookie', async () => {
    const req = new NextRequest('http://localhost/api/v1/test')
    req.cookies.set('__session', 'valid-cookie-value')
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.uid).toBe('cookie-user')
  })
})
