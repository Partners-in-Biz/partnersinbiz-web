// __tests__/lib/companies/store.test.ts

const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockBatch = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockStartAfter = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: mockBatch,
  },
}))

// eslint-disable-next-line import/first
import { loadCompany, sanitizeCompanyForWrite, validateParentChain, validateAccountManager } from '@/lib/companies/store'

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, limit: mockLimit, startAfter: mockStartAfter, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockStartAfter.mockReturnValue(query)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, limit: mockLimit })
  mockBatch.mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit })
  mockBatchCommit.mockResolvedValue(undefined)
})

describe('lib/companies/store', () => {
  describe('loadCompany', () => {
    it('returns ref + data on match', async () => {
      const ref = { get: mockGet, id: 'co-1' }
      mockDoc.mockReturnValue(ref)
      mockGet.mockResolvedValue({ exists: true, id: 'co-1', data: () => ({ orgId: 'org-a', name: 'ACME' }) })
      const result = await loadCompany('co-1', 'org-a')
      expect(result).toEqual({ ref: expect.anything(), data: { orgId: 'org-a', name: 'ACME', id: 'co-1' } })
    })

    it('returns null on cross-tenant access', async () => {
      const ref = { get: mockGet, id: 'co-1' }
      mockDoc.mockReturnValue(ref)
      mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-other', name: 'X' }) })
      const result = await loadCompany('co-1', 'org-a')
      expect(result).toBeNull()
    })

    it('returns null on soft-deleted', async () => {
      const ref = { get: mockGet, id: 'co-1' }
      mockDoc.mockReturnValue(ref)
      mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-a', name: 'X', deleted: true }) })
      const result = await loadCompany('co-1', 'org-a')
      expect(result).toBeNull()
    })

    it('returns null on missing doc', async () => {
      const ref = { get: mockGet, id: 'co-1' }
      mockDoc.mockReturnValue(ref)
      mockGet.mockResolvedValue({ exists: false })
      const result = await loadCompany('co-1', 'org-a')
      expect(result).toBeNull()
    })
  })

  describe('sanitizeCompanyForWrite', () => {
    it('strips undefined fields', () => {
      const out = sanitizeCompanyForWrite({ name: 'ACME', domain: undefined, website: 'https://acme.com', tags: [], notes: '' })
      expect(out).not.toHaveProperty('domain')
      expect(out).toHaveProperty('website', 'https://acme.com')
    })

    it('lowercases + strips protocol from domain', () => {
      const out = sanitizeCompanyForWrite({ name: 'ACME', domain: 'HTTPS://Acme.COM/path', tags: [], notes: '' })
      expect(out.domain).toBe('acme.com')
    })

    it('defaults tags + notes', () => {
      const out = sanitizeCompanyForWrite({ name: 'ACME' } as never)
      expect(out.tags).toEqual([])
      expect(out.notes).toBe('')
    })

    it('normalizes structured legal and billing agreement fields', () => {
      const out = sanitizeCompanyForWrite({
        name: 'ACME',
        legalName: '  ACME Legal Pty Ltd  ',
        tradingName: '  ACME Trading  ',
        registrationNumber: '  2020/000000/07  ',
        vatNumber: '  4000000000  ',
        taxNumber: '  9999999999  ',
        billingEmail: '  ACCOUNTS@ACME.COM  ',
        billingAddress: { line1: '  1 Main Road  ', city: '  Cape Town  ', country: '  South Africa  ' },
        accountsContact: { name: '  Accounts Lead  ', email: '  Accounts@Acme.com  ', phone: '  +27 82 000 0000  ' },
        authorizedSignatory: { name: '  Jane Director  ', title: '  Director  ', email: '  Jane@Acme.com  ' },
        purchaseOrderRequired: true,
        purchaseOrderNumber: '  PO-123  ',
        invoiceInstructions: '  Use PO on every invoice.  ',
      } as never)

      expect(out).toMatchObject({
        legalName: 'ACME Legal Pty Ltd',
        tradingName: 'ACME Trading',
        registrationNumber: '2020/000000/07',
        vatNumber: '4000000000',
        taxNumber: '9999999999',
        billingEmail: 'accounts@acme.com',
        billingAddress: { line1: '1 Main Road', city: 'Cape Town', country: 'South Africa' },
        accountsContact: { name: 'Accounts Lead', email: 'accounts@acme.com', phone: '+27 82 000 0000' },
        authorizedSignatory: { name: 'Jane Director', title: 'Director', email: 'jane@acme.com' },
        purchaseOrderRequired: true,
        purchaseOrderNumber: 'PO-123',
        invoiceInstructions: 'Use PO on every invoice.',
      })
    })
  })

  describe('validateParentChain', () => {
    it('returns true for null parent', async () => {
      expect(await validateParentChain('org-a', 'co-1', undefined)).toBe(true)
    })

    it('rejects self as parent', async () => {
      expect(await validateParentChain('org-a', 'co-1', 'co-1')).toBe(false)
    })

    it('walks chain up to depth 10, rejects cycle', async () => {
      // Mock chain: co-1 → co-2 → co-1 (cycle)
      const fakeChain: Record<string, string> = { 'co-1': 'co-2', 'co-2': 'co-1' }
      mockDoc.mockImplementation((id: string) => ({
        get: () => Promise.resolve({ exists: true, data: () => ({ orgId: 'org-a', parentCompanyId: fakeChain[id] }) }),
        id,
      }))
      // co-3 → co-1 → co-2 → co-1 (cycle detected)
      expect(await validateParentChain('org-a', 'co-3', 'co-1')).toBe(false)
    })
  })
})
