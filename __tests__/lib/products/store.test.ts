// __tests__/lib/products/store.test.ts

const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockAdd = jest.fn()
const mockDocUpdate = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { listProducts, getProduct, createProduct, updateProduct, deleteProduct } from '@/lib/products/store'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const ACTOR: MemberRef = { uid: 'user-1', displayName: 'Test User', kind: 'human' }

function makeQuery() {
  return {
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = makeQuery()
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, add: mockAdd })
})

// ── listProducts ─────────────────────────────────────────────────────────────

describe('listProducts', () => {
  it('returns active products for the org', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'prod-2', data: () => ({ orgId: 'org-a', name: 'Gadget', unitPrice: 200, currency: 'USD' }) },
        { id: 'prod-1', data: () => ({ orgId: 'org-a', name: 'Widget', unitPrice: 100, currency: 'USD' }) },
        { id: 'prod-deleted', data: () => ({ orgId: 'org-a', name: 'Archived', unitPrice: 50, currency: 'USD', deleted: true }) },
      ],
    })
    const results = await listProducts('org-a')
    expect(results).toHaveLength(2)
    expect(results.map((product) => product.id)).toEqual(['prod-2', 'prod-1'])
  })

  it('keeps the Firestore query index-safe', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await listProducts('org-a')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-a')
    expect(mockWhere).not.toHaveBeenCalledWith('deleted', '!=', true)
    expect(mockLimit).toHaveBeenCalledWith(1000)
  })

  it('returns empty array when no products found', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    const results = await listProducts('org-empty')
    expect(results).toEqual([])
  })
})

// ── getProduct ───────────────────────────────────────────────────────────────

describe('getProduct', () => {
  it('returns product when found with matching orgId', async () => {
    const ref = { get: mockGet, id: 'prod-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      id: 'prod-1',
      data: () => ({ orgId: 'org-a', name: 'Widget', unitPrice: 100, currency: 'USD' }),
    })
    const result = await getProduct('org-a', 'prod-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('prod-1')
    expect(result!.name).toBe('Widget')
  })

  it('returns null when product does not exist', async () => {
    const ref = { get: mockGet, id: 'prod-x', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    const result = await getProduct('org-a', 'prod-x')
    expect(result).toBeNull()
  })

  it('returns null when orgId does not match (cross-tenant guard)', async () => {
    const ref = { get: mockGet, id: 'prod-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      id: 'prod-1',
      data: () => ({ orgId: 'org-other', name: 'Widget', unitPrice: 100, currency: 'USD' }),
    })
    const result = await getProduct('org-a', 'prod-1')
    expect(result).toBeNull()
  })
})

// ── createProduct ─────────────────────────────────────────────────────────────

describe('createProduct', () => {
  it('adds a product with correct shape including server timestamps and actor refs', async () => {
    const fakeRef = { id: 'new-prod', get: mockGet }
    mockAdd.mockResolvedValue(fakeRef)
    mockGet.mockResolvedValue({
      data: () => ({ orgId: 'org-a', name: 'Widget', unitPrice: 100, currency: 'USD' }),
    })
    const input = { orgId: 'org-a', name: 'Widget', unitPrice: 100, currency: 'USD' as const }
    await createProduct('org-a', input, ACTOR)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a',
      name: 'Widget',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
      createdByRef: ACTOR,
      updatedByRef: ACTOR,
    }))
  })

  it('returns the created product with its new id', async () => {
    const fakeRef = { id: 'new-prod-42', get: mockGet }
    mockAdd.mockResolvedValue(fakeRef)
    mockGet.mockResolvedValue({
      data: () => ({ orgId: 'org-a', name: 'Gizmo', unitPrice: 50, currency: 'ZAR' }),
    })
    const input = { orgId: 'org-a', name: 'Gizmo', unitPrice: 50, currency: 'ZAR' as const }
    const result = await createProduct('org-a', input, ACTOR)
    expect(result.id).toBe('new-prod-42')
  })
})

// ── updateProduct ─────────────────────────────────────────────────────────────

describe('updateProduct', () => {
  it('calls doc.update() with patch and updatedByRef', async () => {
    const ref = { get: mockGet, id: 'prod-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)
    mockGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org-a', name: 'Old Name', unitPrice: 100, currency: 'USD' }) })
      .mockResolvedValueOnce({ data: () => ({ orgId: 'org-a', name: 'New Name', unitPrice: 100, currency: 'USD' }) })
    await updateProduct('org-a', 'prod-1', { name: 'New Name' }, ACTOR)
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Name',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedByRef: ACTOR,
    }))
  })

  it('throws when product is not found', async () => {
    const ref = { get: mockGet, id: 'prod-x', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    await expect(updateProduct('org-a', 'prod-x', { name: 'x' }, ACTOR)).rejects.toThrow('Product not found: prod-x')
  })

  it('throws when orgId does not match', async () => {
    const ref = { get: mockGet, id: 'prod-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-other', name: 'X', unitPrice: 10, currency: 'USD' }) })
    await expect(updateProduct('org-a', 'prod-1', { name: 'x' }, ACTOR)).rejects.toThrow('Product not found: prod-1')
  })
})

// ── deleteProduct ─────────────────────────────────────────────────────────────

describe('deleteProduct', () => {
  it('sets deleted: true on the product', async () => {
    const ref = { get: mockGet, id: 'prod-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-a', name: 'Widget', unitPrice: 100, currency: 'USD' }) })
    await deleteProduct('org-a', 'prod-1', ACTOR)
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      deleted: true,
      updatedAt: 'SERVER_TIMESTAMP',
      updatedByRef: ACTOR,
    }))
  })

  it('throws when product is not found', async () => {
    const ref = { get: mockGet, id: 'prod-x', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    await expect(deleteProduct('org-a', 'prod-x', ACTOR)).rejects.toThrow('Product not found: prod-x')
  })

  it('throws on cross-tenant delete attempt', async () => {
    const ref = { get: mockGet, id: 'prod-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-other', name: 'Widget', unitPrice: 100, currency: 'USD' }) })
    await expect(deleteProduct('org-a', 'prod-1', ACTOR)).rejects.toThrow('Product not found: prod-1')
  })
})
