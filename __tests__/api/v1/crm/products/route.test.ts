/**
 * Tests for GET /api/v1/crm/products and POST /api/v1/crm/products
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    delete: () => ({ _type: 'deleteField' }),
  },
  Timestamp: {
    now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/products/store', () => ({
  listProducts: jest.fn(),
  getProduct: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  deleteProduct: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as productStore from '@/lib/products/store'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-products-root'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function uidFor(label: string) {
  return `uid-products-${label}`
}

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    orgId: 'org-1',
    name: 'Widget',
    unitPrice: 99.99,
    currency: 'ZAR',
    active: true,
    createdAt: { seconds: 1000, nanoseconds: 0 },
    updatedAt: { seconds: 1000, nanoseconds: 0 },
    createdByRef: { uid: 'u1', displayName: 'Test User', kind: 'human' },
    updatedByRef: { uid: 'u1', displayName: 'Test User', kind: 'human' },
    ...overrides,
  }
}

function stageAuth(member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string }) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/products/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/products', () => {
  it('returns 200 with products array', async () => {
    const uid = uidFor('member-get')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(productStore.listProducts as jest.Mock).mockResolvedValue([buildProduct()])

    const req = callAsMember(member, 'GET', '/api/v1/crm/products')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.products)).toBe(true)
    expect(body.data.products).toHaveLength(1)
    expect(body.data.products[0].name).toBe('Widget')
  })

  it('returns 200 with empty array when no products', async () => {
    const uid = uidFor('member-get-empty')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(productStore.listProducts as jest.Mock).mockResolvedValue([])

    const req = callAsMember(member, 'GET', '/api/v1/crm/products')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.products).toHaveLength(0)
  })

  it('returns 401 when unauthenticated', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockRejectedValue(new Error('no session'))
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
    })
    const req = new NextRequest('http://localhost/api/v1/crm/products')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when viewer tries GET (role gate is member)', async () => {
    const uid = uidFor('viewer-get')
    const member = seedOrgMember('org-1', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'GET', '/api/v1/crm/products')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(403)
  })

  it('calls listProducts with correct orgId', async () => {
    const uid = uidFor('member-org-check')
    const member = seedOrgMember('org-specific', uid, { role: 'member' })
    stageAuth(member)
    ;(productStore.listProducts as jest.Mock).mockResolvedValue([])

    const req = callAsMember(member, 'GET', '/api/v1/crm/products')
    await routeModule.GET(req)
    expect(productStore.listProducts).toHaveBeenCalledWith('org-specific')
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/products', () => {
  it('returns 201 and creates product', async () => {
    const uid = uidFor('admin-post')
    const member = seedOrgMember('org-1', uid, { role: 'admin', firstName: 'Alice', lastName: 'A' })
    stageAuth(member)
    const created = buildProduct({ name: 'New Widget', unitPrice: 49.99 })
    ;(productStore.createProduct as jest.Mock).mockResolvedValue(created)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'New Widget',
      unitPrice: 49.99,
      currency: 'ZAR',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.product.name).toBe('New Widget')
  })

  it('returns 400 when name is missing', async () => {
    const uid = uidFor('admin-no-name')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      unitPrice: 10,
      currency: 'ZAR',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it('returns 400 when unitPrice is missing', async () => {
    const uid = uidFor('admin-no-price')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Widget',
      currency: 'ZAR',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unitPrice/i)
  })

  it('returns 400 when currency is missing', async () => {
    const uid = uidFor('admin-no-currency')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Widget',
      unitPrice: 10,
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/currency/i)
  })

  it('returns 403 when member (not admin) tries to POST', async () => {
    const uid = uidFor('member-post')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Widget',
      unitPrice: 10,
      currency: 'ZAR',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when viewer tries to POST', async () => {
    const uid = uidFor('viewer-post')
    const member = seedOrgMember('org-1', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Widget',
      unitPrice: 10,
      currency: 'ZAR',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })

  it('ignores id/orgId/createdAt/createdByRef/updatedByRef from body', async () => {
    const uid = uidFor('admin-denylist')
    const member = seedOrgMember('org-safe', uid, { role: 'admin' })
    stageAuth(member)
    const created = buildProduct({ orgId: 'org-safe' })
    ;(productStore.createProduct as jest.Mock).mockResolvedValue(created)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Safe Widget',
      unitPrice: 5,
      currency: 'USD',
      id: 'injected-id',
      orgId: 'evil-org',
      createdAt: 'injected-ts',
      updatedAt: 'injected-ts',
      createdByRef: { uid: 'evil' },
      updatedByRef: { uid: 'evil' },
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)

    // The store was called with an input that does NOT include the denylist fields
    const [calledOrgId, calledInput] = (productStore.createProduct as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-safe')
    expect(calledInput).not.toHaveProperty('id')
    expect(calledInput).not.toHaveProperty('orgId')
    expect(calledInput).not.toHaveProperty('createdAt')
    expect(calledInput).not.toHaveProperty('updatedAt')
    expect(calledInput).not.toHaveProperty('createdByRef')
    expect(calledInput).not.toHaveProperty('updatedByRef')
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin-empty')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {})
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 when store throws unexpected error', async () => {
    const uid = uidFor('admin-store-err')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.createProduct as jest.Mock).mockRejectedValue(new Error('DB connection lost'))

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Widget',
      unitPrice: 10,
      currency: 'ZAR',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(500)
  })

  it('passes actor to createProduct', async () => {
    const uid = uidFor('admin-actor')
    const member = seedOrgMember('org-actor', uid, { role: 'admin', firstName: 'Bob', lastName: 'B' })
    stageAuth(member)
    ;(productStore.createProduct as jest.Mock).mockResolvedValue(buildProduct())

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'Actor Widget',
      unitPrice: 20,
      currency: 'ZAR',
    })
    await routeModule.POST(req)
    const [, , actor] = (productStore.createProduct as jest.Mock).mock.calls[0]
    expect(actor.uid).toBe(uid)
    expect(actor.kind).toBe('human')
  })

  it('agent (Bearer) can POST', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    ;(productStore.createProduct as jest.Mock).mockResolvedValue(buildProduct())

    const req = callAsAgent('org-agent', 'POST', '/api/v1/crm/products', {
      name: 'Agent Widget',
      unitPrice: 15,
      currency: 'ZAR',
    }, AI_API_KEY)
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const [, , actor] = (productStore.createProduct as jest.Mock).mock.calls[0]
    expect(actor.kind).toBe('agent')
  })
})
