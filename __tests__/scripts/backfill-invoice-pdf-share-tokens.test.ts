jest.mock('@/lib/invoices/share-token', () => ({
  generateInvoicePdfShareToken: jest.fn(() => 'generated-pdf-token'),
}))

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
})
