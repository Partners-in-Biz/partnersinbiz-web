/**
 * Map invoice / quote Firestore records into the shape expected by generateInvoiceHtml.
 */

export type CommerceHtmlKind = 'invoice' | 'quote'

export function invoiceLikeFromInvoiceRecord(data: Record<string, unknown>, id?: string) {
  return {
    id,
    ...data,
    invoiceNumber: typeof data.invoiceNumber === 'string' && data.invoiceNumber.trim()
      ? data.invoiceNumber
      : id ?? 'Invoice',
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
  }
}

export function invoiceLikeFromQuoteRecord(data: Record<string, unknown>, id?: string) {
  const quoteNumber = typeof data.quoteNumber === 'string' && data.quoteNumber.trim()
    ? data.quoteNumber
    : id ?? 'Quote'
  return {
    id,
    ...data,
    invoiceNumber: quoteNumber,
    issueDate: data.issueDate ?? null,
    dueDate: data.validUntil ?? null,
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
  }
}
