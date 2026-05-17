// __tests__/lib/customFields/store.test.ts

const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

// eslint-disable-next-line import/first
import {
  loadDefinition,
  getDefinitionsForResource,
  assertKeyUnique,
  sanitizeDefinitionForWrite,
  CustomFieldKeyError,
} from '@/lib/customFields/store'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

function makeQuery() {
  const q: Record<string, jest.Mock> = {}
  q.where = mockWhere
  q.orderBy = mockOrderBy
  q.limit = mockLimit
  q.get = mockGet
  return q
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = makeQuery()
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere })
})

// ------------------------------------------------------------------
describe('loadDefinition', () => {
  it('returns {ref, data} on match', async () => {
    const fakeData: Partial<CustomFieldDefinition> = {
      orgId: 'org-store-a',
      resource: 'contact',
      key: 'tier',
      label: 'Tier',
      type: 'dropdown',
      required: true,
      order: 0,
    }
    const ref = { get: mockGet, id: 'def-store-001' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => fakeData })
    const result = await loadDefinition('def-store-001', 'org-store-a')
    expect(result).not.toBeNull()
    expect(result!.data.id).toBe('def-store-001')
    expect(result!.data.orgId).toBe('org-store-a')
  })

  it('returns null on cross-tenant access', async () => {
    const ref = { get: mockGet, id: 'def-store-002' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-other', key: 'tier' }) })
    const result = await loadDefinition('def-store-002', 'org-store-a')
    expect(result).toBeNull()
  })

  it('returns null on soft-deleted definition', async () => {
    const ref = { get: mockGet, id: 'def-store-003' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-store-a', key: 'tier', deleted: true }) })
    const result = await loadDefinition('def-store-003', 'org-store-a')
    expect(result).toBeNull()
  })

  it('returns null on missing doc', async () => {
    const ref = { get: mockGet, id: 'def-store-004' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    const result = await loadDefinition('def-store-004', 'org-store-a')
    expect(result).toBeNull()
  })

  it('returns null when id or orgId is empty string', async () => {
    const result = await loadDefinition('', 'org-store-a')
    expect(result).toBeNull()
    const result2 = await loadDefinition('def-store-001', '')
    expect(result2).toBeNull()
  })
})

// ------------------------------------------------------------------
describe('getDefinitionsForResource', () => {
  it('returns active definitions for (orgId, resource) ordered by order ASC', async () => {
    const docs = [
      { id: 'def-store-010', data: () => ({ orgId: 'org-store-b', resource: 'contact', key: 'tier', order: 0 }) },
      { id: 'def-store-011', data: () => ({ orgId: 'org-store-b', resource: 'contact', key: 'budget', order: 1 }) },
    ]
    mockGet.mockResolvedValue({ docs, empty: false })
    const result = await getDefinitionsForResource('org-store-b', 'contact')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('def-store-010')
    expect(result[1].id).toBe('def-store-011')
    // Verify where chaining was called with correct args
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-store-b')
    expect(mockWhere).toHaveBeenCalledWith('resource', '==', 'contact')
    expect(mockWhere).toHaveBeenCalledWith('deleted', '!=', true)
  })

  it('returns empty array when no matching docs exist', async () => {
    mockGet.mockResolvedValue({ docs: [], empty: true })
    const result = await getDefinitionsForResource('org-store-b', 'deal')
    expect(result).toHaveLength(0)
  })
})

// ------------------------------------------------------------------
describe('sanitizeDefinitionForWrite', () => {
  it('strips NEVER_FROM_BODY keys from input', () => {
    const input = {
      key: 'tier',
      label: 'Tier',
      type: 'dropdown',
      required: false,
      order: 0,
      // NEVER_FROM_BODY fields:
      id: 'should-be-stripped',
      orgId: 'should-be-stripped',
      createdBy: 'uid-000',
      createdByRef: { uid: 'uid-000', displayName: 'Alice', kind: 'human' },
      createdAt: new Date(),
      updatedBy: 'uid-000',
      updatedByRef: { uid: 'uid-000', displayName: 'Alice', kind: 'human' },
      updatedAt: new Date(),
      deleted: false,
    }
    const out = sanitizeDefinitionForWrite(input as never)
    expect(out).not.toHaveProperty('id')
    expect(out).not.toHaveProperty('orgId')
    expect(out).not.toHaveProperty('createdBy')
    expect(out).not.toHaveProperty('createdByRef')
    expect(out).not.toHaveProperty('createdAt')
    expect(out).not.toHaveProperty('updatedBy')
    expect(out).not.toHaveProperty('updatedByRef')
    expect(out).not.toHaveProperty('updatedAt')
    expect(out).not.toHaveProperty('deleted')
    expect(out.key).toBe('tier')
    expect(out.label).toBe('Tier')
  })

  it('lowercases + trims the key field', () => {
    const out = sanitizeDefinitionForWrite({ key: 'MyField', label: 'My Field', type: 'text', required: false, order: 0, createdAt: null, updatedAt: null } as never)
    expect(out.key).toBe('myfield')
  })

  it('throws CustomFieldKeyError with key value for key not matching regex', () => {
    expect(() => sanitizeDefinitionForWrite({ key: '123invalid', label: 'Bad', type: 'text', required: false, order: 0, createdAt: null, updatedAt: null } as never))
      .toThrow(CustomFieldKeyError)
  })

  it('throws CustomFieldKeyError whose message includes the invalid key', () => {
    try {
      sanitizeDefinitionForWrite({ key: 'has space', label: 'Bad', type: 'text', required: false, order: 0, createdAt: null, updatedAt: null } as never)
      fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CustomFieldKeyError)
      expect((err as Error).message).toContain('has space')
    }
  })

  it('strips undefined values', () => {
    const out = sanitizeDefinitionForWrite({ key: 'tier', label: 'Tier', type: 'text', required: false, order: 0, helpText: undefined, createdAt: null, updatedAt: null } as never)
    expect(out).not.toHaveProperty('helpText')
  })
})

// ------------------------------------------------------------------
describe('assertKeyUnique', () => {
  it('returns true when no other definition has the same key in (orgId, resource)', async () => {
    mockGet.mockResolvedValue({ empty: true, size: 0, docs: [] })
    const result = await assertKeyUnique('org-store-c', 'contact', 'tier')
    expect(result).toBe(true)
  })

  it('returns false when another definition has the same key', async () => {
    mockGet.mockResolvedValue({ empty: false, size: 1, docs: [{ id: 'def-store-020' }] })
    const result = await assertKeyUnique('org-store-c', 'contact', 'tier')
    expect(result).toBe(false)
  })

  it('returns true when excludeId matches the only conflicting definition', async () => {
    mockGet.mockResolvedValue({ empty: false, size: 1, docs: [{ id: 'def-store-020' }] })
    const result = await assertKeyUnique('org-store-c', 'contact', 'tier', 'def-store-020')
    expect(result).toBe(true)
  })

  it('returns false when excludeId does not match the conflicting definition', async () => {
    mockGet.mockResolvedValue({ empty: false, size: 1, docs: [{ id: 'def-store-021' }] })
    const result = await assertKeyUnique('org-store-c', 'contact', 'tier', 'def-store-020')
    expect(result).toBe(false)
  })
})
