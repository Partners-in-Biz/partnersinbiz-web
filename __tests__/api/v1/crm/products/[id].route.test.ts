/**
 * Tests for PUT /api/v1/crm/products/:id and DELETE /api/v1/crm/products/:id
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
    now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
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
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-products-id'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function uidFor(label: string) {
  return `uid-products-id-${label}`
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
    updatedAt: { seconds: 2000, nanoseconds: 0 },
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
        where: () => ({
          get: () => Promise.resolve({ docs: [{ data: () => ({ orgId: member.orgId, uid: member.uid, role: member.role }) }] }),
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

// ── routeCtx helper ──────────────────────────────────────────────────────────

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/products/[id]/route')
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/crm/products/:id', () => {
  it('returns 200 and updated product', async () => {
    const uid = uidFor('admin-put')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    const updated = buildProduct({ name: 'Updated Widget', unitPrice: 120 })
    ;(productStore.updateProduct as jest.Mock).mockResolvedValue(updated)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {
      name: 'Updated Widget',
      unitPrice: 120,
    })
    const res = await routeModule.PUT(req, makeCtx('prod-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.product.name).toBe('Updated Widget')
  })

  it('returns 404 when product not found', async () => {
    const uid = uidFor('admin-put-404')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.updateProduct as jest.Mock).mockRejectedValue(new Error('Product not found'))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/missing', {
      name: 'Ghost Widget',
    })
    const res = await routeModule.PUT(req, makeCtx('missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin-put-empty')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {})
    const res = await routeModule.PUT(req, makeCtx('prod-1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid unitPrice patch', async () => {
    const uid = uidFor('admin-put-invalid-price')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {
      unitPrice: -10,
    })
    const res = await routeModule.PUT(req, makeCtx('prod-1'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unitPrice/i)
  })

  it('returns 403 when member tries to PUT', async () => {
    const uid = uidFor('member-put')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {
      name: 'Widget',
    })
    const res = await routeModule.PUT(req, makeCtx('prod-1'))
    expect(res.status).toBe(403)
  })

  it('returns 403 when viewer tries to PUT', async () => {
    const uid = uidFor('viewer-put')
    const member = seedOrgMember('org-1', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {
      name: 'Widget',
    })
    const res = await routeModule.PUT(req, makeCtx('prod-1'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on unexpected store error', async () => {
    const uid = uidFor('admin-put-err')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.updateProduct as jest.Mock).mockRejectedValue(new Error('DB crash'))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {
      name: 'Widget',
    })
    const res = await routeModule.PUT(req, makeCtx('prod-1'))
    expect(res.status).toBe(500)
  })

  it('passes patch and actor to updateProduct', async () => {
    const uid = uidFor('admin-put-actor')
    const member = seedOrgMember('org-1', uid, { role: 'admin', firstName: 'Carol', lastName: 'C' })
    stageAuth(member)
    ;(productStore.updateProduct as jest.Mock).mockResolvedValue(buildProduct())

    const req = callAsMember(member, 'PUT', '/api/v1/crm/products/prod-1', {
      unitPrice: 200,
      currency: 'USD',
    })
    await routeModule.PUT(req, makeCtx('prod-1'))
    const [calledOrgId, calledId, calledPatch, calledActor] = (productStore.updateProduct as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-1')
    expect(calledId).toBe('prod-1')
    expect(calledPatch.unitPrice).toBe(200)
    expect(calledPatch.currency).toBe('USD')
    expect(calledActor.uid).toBe(uid)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/products/:id', () => {
  it('returns 200 with deleted: true', async () => {
    const uid = uidFor('admin-delete')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.deleteProduct as jest.Mock).mockResolvedValue(undefined)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/products/prod-1')
    const res = await routeModule.DELETE(req, makeCtx('prod-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe(true)
  })

  it('returns 404 when product not found', async () => {
    const uid = uidFor('admin-delete-404')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.deleteProduct as jest.Mock).mockRejectedValue(new Error('Product not found'))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/products/missing')
    const res = await routeModule.DELETE(req, makeCtx('missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 403 when member tries to DELETE', async () => {
    const uid = uidFor('member-delete')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/products/prod-1')
    const res = await routeModule.DELETE(req, makeCtx('prod-1'))
    expect(res.status).toBe(403)
  })

  it('returns 403 when viewer tries to DELETE', async () => {
    const uid = uidFor('viewer-delete')
    const member = seedOrgMember('org-1', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/products/prod-1')
    const res = await routeModule.DELETE(req, makeCtx('prod-1'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on unexpected store error', async () => {
    const uid = uidFor('admin-delete-err')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.deleteProduct as jest.Mock).mockRejectedValue(new Error('DB crash'))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/products/prod-1')
    const res = await routeModule.DELETE(req, makeCtx('prod-1'))
    expect(res.status).toBe(500)
  })

  it('passes correct orgId and productId to deleteProduct', async () => {
    const uid = uidFor('admin-delete-args')
    const member = seedOrgMember('org-check', uid, { role: 'admin' })
    stageAuth(member)
    ;(productStore.deleteProduct as jest.Mock).mockResolvedValue(undefined)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/products/target-prod')
    await routeModule.DELETE(req, makeCtx('target-prod'))
    const [calledOrgId, calledId] = (productStore.deleteProduct as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-check')
    expect(calledId).toBe('target-prod')
  })
})
