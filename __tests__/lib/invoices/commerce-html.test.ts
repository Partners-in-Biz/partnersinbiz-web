import { invoiceLikeFromInvoiceRecord, invoiceLikeFromQuoteRecord } from '@/lib/invoices/commerce-html'

describe('commerce-html mappers', () => {
  it('keeps invoice numbers and line items for HTML generation', () => {
    const mapped = invoiceLikeFromInvoiceRecord({
      invoiceNumber: 'INV-42',
      lineItems: [{ description: 'Retainer', quantity: 1, unitPrice: 1000, amount: 1000 }],
      total: 1000,
    }, 'inv-1')

    expect(mapped.invoiceNumber).toBe('INV-42')
    expect(mapped.id).toBe('inv-1')
    expect(mapped.lineItems).toHaveLength(1)
  })

  it('maps quote numbers onto the invoice HTML number slot and validUntil onto dueDate', () => {
    const mapped = invoiceLikeFromQuoteRecord({
      quoteNumber: 'Q-9',
      issueDate: '2026-07-01',
      validUntil: '2026-07-31',
      lineItems: [],
      total: 0,
    }, 'quote-1')

    expect(mapped.invoiceNumber).toBe('Q-9')
    expect(mapped.dueDate).toBe('2026-07-31')
    expect(mapped.issueDate).toBe('2026-07-01')
  })
})
