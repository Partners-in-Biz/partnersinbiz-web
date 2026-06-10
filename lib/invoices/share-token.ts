import { randomBytes, timingSafeEqual } from 'node:crypto'

export const INVOICE_PDF_SHARE_TOKEN_BYTES = 24
export const INVOICE_PDF_RATE_LIMIT = 30
export const INVOICE_PDF_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export function generateInvoicePdfShareToken(): string {
  return randomBytes(INVOICE_PDF_SHARE_TOKEN_BYTES).toString('hex')
}

export function invoicePdfShareTokenMatches(storedToken: unknown, providedToken: unknown): boolean {
  if (typeof storedToken !== 'string' || typeof providedToken !== 'string') return false
  if (!storedToken || !providedToken) return false

  const stored = Buffer.from(storedToken)
  const provided = Buffer.from(providedToken)
  if (stored.length !== provided.length) return false

  return timingSafeEqual(stored, provided)
}

export function invoicePdfRateLimitKey(invoiceId: string, ip: string): string {
  return `invoice_pdf:${invoiceId}:${ip || 'unknown'}`
}
