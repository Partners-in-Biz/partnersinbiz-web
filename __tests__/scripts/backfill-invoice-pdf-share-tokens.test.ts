export {}

jest.mock('@/lib/invoices/share-token', () => ({
  generateInvoicePdfShareToken: jest.fn(() => 'generated-pdf-token'),
}))

const mockUpdate = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (...args: unknown[]) => mockCollection(...args),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      docs: [
        {
          data: () => ({ invoiceNumber: 'INV-001' }),
          ref: { update: mockUpdate },
        },
        {
          data: () => ({ invoiceNumber: 'INV-002', pdfShareToken: 'existing-token' }),
          ref: { update: jest.fn() },
        },
      ],
    }),
  })
})

describe('backfill invoice PDF share tokens', () => {
  it('plans a pdfShareToken patch for invoices missing the dedicated PDF token', async () => {
    const { buildInvoicePdfShareTokenPatch } = await import('@/scripts/backfill-invoice-pdf-share-tokens')

    expect(buildInvoicePdfShareTokenPatch({ invoiceNumber: 'INV-001' })).toEqual({
      pdfShareToken: 'generated-pdf-token',
    })
  })

  it('skips invoices that already have a PDF share token', async () => {
    const { buildInvoicePdfShareTokenPatch } = await import('@/scripts/backfill-invoice-pdf-share-tokens')

    expect(buildInvoicePdfShareTokenPatch({ pdfShareToken: 'existing-token' })).toBeNull()
  })

  it('does not write token patches during a dry run', async () => {
    const { backfillInvoicePdfShareTokens } = await import('@/scripts/backfill-invoice-pdf-share-tokens')

    await expect(backfillInvoicePdfShareTokens()).resolves.toEqual({ scanned: 2, updated: 1 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('writes token patches only when commit is enabled', async () => {
    const { backfillInvoicePdfShareTokens } = await import('@/scripts/backfill-invoice-pdf-share-tokens')

    await expect(backfillInvoicePdfShareTokens({ commit: true })).resolves.toEqual({ scanned: 2, updated: 1 })
    expect(mockUpdate).toHaveBeenCalledWith({
      pdfShareToken: 'generated-pdf-token',
      updatedAt: 'SERVER_TIMESTAMP',
    })
  })
})
