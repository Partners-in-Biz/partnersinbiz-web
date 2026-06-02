jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'

process.env.SESSION_COOKIE_NAME = '__session'

function stageAuth(
  member: { uid: string; orgId: string; role: string },
  opts?: {
    productDocs?: Array<{ id: string; data: Record<string, unknown> }>
    capturedSet?: jest.Mock
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: jest.fn().mockReturnValue({
          get: () => Promise.resolve({
            docs: [{
              id: `${member.orgId}_${member.uid}`,
              data: () => ({ orgId: member.orgId, uid: member.uid }),
            }],
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    }
    if (name === 'products') {
      const docs = (opts?.productDocs ?? []).map(doc => ({
        id: doc.id,
        data: () => doc.data,
      }))
      const add = jest.fn().mockResolvedValue({
        id: 'product-new',
        get: jest.fn().mockResolvedValue({
          data: () => ({ ...opts?.capturedSet?.mock.calls[0]?.[0], orgId: member.orgId }),
        }),
      })
      const query = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs, size: docs.length }),
        add,
        doc: jest.fn().mockReturnValue({
          id: 'product-new',
          set: opts?.capturedSet ?? jest.fn().mockResolvedValue(undefined),
        }),
      }
      return query
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

describe('GET /api/v1/crm/products', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns active org products sorted by name without requiring deleted to exist', async () => {
    const member = seedOrgMember('org-products', 'uid-member', { role: 'member' })
    stageAuth(member, {
      productDocs: [
        { id: 'z', data: { orgId: member.orgId, name: 'Zulu', unitPrice: 100, currency: 'ZAR', active: false } },
        { id: 'b', data: { orgId: member.orgId, name: 'Bravo', unitPrice: 200, currency: 'ZAR' } },
        { id: 'h', data: { orgId: member.orgId, name: 'Hidden', unitPrice: 300, currency: 'ZAR', deleted: true } },
        { id: 'a', data: { orgId: member.orgId, name: 'Alpha', unitPrice: 400, currency: 'ZAR', deleted: false } },
      ],
    })

    const req = callAsMember(member, 'GET', '/api/v1/crm/products')
    const { GET } = await import('@/app/api/v1/crm/products/route')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.products.map((product: { name: string }) => product.name)).toEqual(['Alpha', 'Bravo'])
  })
})

describe('POST /api/v1/crm/products', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects negative product prices', async () => {
    const member = seedOrgMember('org-products', 'uid-admin', { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/products', {
      name: 'SEO Sprint',
      unitPrice: -1,
      currency: 'ZAR',
    })
    const { POST } = await import('@/app/api/v1/crm/products/route')
    const res = await POST(req)

    expect(res.status).toBe(400)
  })
})
