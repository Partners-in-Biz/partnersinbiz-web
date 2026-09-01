/**
 * @jest-environment node
 */
jest.mock('@/lib/orgMembers/platform-staff', () => ({
  loadPlatformStaffMembership: (...args: unknown[]) => mockLoadStaff(...args),
}))

jest.mock('@/lib/billing/crm-record-scope', () => ({
  resolveBillingCrmAuthContext: (...args: unknown[]) => mockResolveBillingCrm(...args),
  crmActorCanReadBillingRecord: (...args: unknown[]) => mockCrmCanRead(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
  },
}))

const mockLoadStaff = jest.fn()
const mockResolveBillingCrm = jest.fn()
const mockCrmCanRead = jest.fn()
const mockCollection = jest.fn()

import type { ApiUser } from '@/lib/api/types'
import { isInvoiceIssuerAccess, requireInvoiceAccess, resolveInvoiceAccessKind } from '@/lib/invoices/access'

describe('invoice access staff issuer perspective', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCrmCanRead.mockResolvedValue(true)
    mockResolveBillingCrm.mockResolvedValue({ orgId: 'pib-platform-owner', role: 'member' })
  })

  it('classifies dual-scope staff as issuer when conversation org is the recipient', async () => {
    mockLoadStaff.mockResolvedValue({
      platformOrgId: 'pib-platform-owner',
      role: 'member',
      policy: {},
    })
    mockCollection.mockReturnValue({
      doc: () => ({
        get: async () => ({
          exists: true,
          id: 'inv-1',
          data: () => ({
            orgId: 'pib-platform-owner',
            sourceOrgId: 'pib-platform-owner',
            recipientOrgId: 'wS5pgwa6c9WbPocf4w0w',
            createdBy: 'stean',
          }),
          ref: { id: 'inv-1' },
        }),
      }),
    })

    const stean = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'wS5pgwa6c9WbPocf4w0w',
      orgIds: ['wS5pgwa6c9WbPocf4w0w', 'pib-platform-owner'],
    } as ApiUser

    const access = await requireInvoiceAccess(stean, 'inv-1', 'wS5pgwa6c9WbPocf4w0w')
    expect(access.ok).toBe(true)
    if (!access.ok) return
    expect(access.perspectiveOrgId).toBe('pib-platform-owner')
    expect(isInvoiceIssuerAccess(access.accessKind)).toBe(true)
    expect(mockResolveBillingCrm).toHaveBeenCalledWith(stean, 'pib-platform-owner')
  })

  it('keeps true recipients as recipient when they are not platform staff', async () => {
    mockLoadStaff.mockResolvedValue(null)
    mockCollection.mockReturnValue({
      doc: () => ({
        get: async () => ({
          exists: true,
          id: 'inv-2',
          data: () => ({
            orgId: 'pib-platform-owner',
            sourceOrgId: 'pib-platform-owner',
            recipientOrgId: 'wS5pgwa6c9WbPocf4w0w',
          }),
          ref: { id: 'inv-2' },
        }),
      }),
    })

    const client = {
      uid: 'client-1',
      role: 'client',
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      activeOrgId: 'wS5pgwa6c9WbPocf4w0w',
      orgIds: ['wS5pgwa6c9WbPocf4w0w'],
    } as ApiUser

    const access = await requireInvoiceAccess(client, 'inv-2', 'wS5pgwa6c9WbPocf4w0w')
    expect(access.ok).toBe(true)
    if (!access.ok) return
    expect(access.accessKind).toBe('recipient')
    expect(resolveInvoiceAccessKind(access.data, access.perspectiveOrgId)).toBe('recipient')
  })
})
