import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface QuoteDocument extends Record<string, unknown> {
  orgId?: string | null
  sourceOrgId?: string | null
  recipientOrgId?: string | null
  targetOrgId?: string | null
  quoteNumber?: string | null
  status?: string | null
  total?: number | null
  currency?: string | null
  recipientName?: string | null
  recipientEmail?: string | null
  recipientCompanyName?: string | null
  clientDetails?: {
    name?: string | null
    email?: string | null
  } | null
  validUntil?: unknown
  sentAt?: unknown
  acceptedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
  convertedInvoiceId?: string | null
  notes?: string | null
  deleted?: boolean | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function money(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  const code = clean(currency) ?? 'ZAR'
  const symbol = code === 'ZAR' ? 'R' : code === 'USD' ? '$' : code === 'EUR' ? '€' : `${code} `
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isoDate(value: unknown): string | null {
  const date = normalizeTimestamp(value)
  return date ? date.toISOString().slice(0, 10) : null
}

function quoteNumber(doc: QuoteDocument, docId: string): string {
  return clean(doc.quoteNumber) ?? docId
}

function recipientName(doc: QuoteDocument): string | null {
  return clean(doc.recipientName)
    ?? clean(doc.recipientCompanyName)
    ?? clean(doc.clientDetails?.name)
    ?? clean(doc.clientDetails?.email)
    ?? clean(doc.recipientEmail)
}

function quoteOrgId(doc: QuoteDocument): string {
  if (doc.status === 'sent') return clean(doc.recipientOrgId) ?? clean(doc.targetOrgId) ?? clean(doc.sourceOrgId) ?? clean(doc.orgId) ?? extractOrgId(doc) ?? ''
  return clean(doc.sourceOrgId) ?? clean(doc.orgId) ?? clean(doc.recipientOrgId) ?? clean(doc.targetOrgId) ?? extractOrgId(doc) ?? ''
}

export const quoteAdapter: BriefingSourceAdapter<QuoteDocument> = {
  sourceType: 'quote',
  collectionPath: 'quotes',

  hashSource(doc: QuoteDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['quoteNumber', 'status', 'total', 'currency', 'validUntil', 'updatedAt', 'convertedInvoiceId'])
  },

  shouldGenerate(doc: QuoteDocument): boolean {
    if (doc.deleted === true) return false
    if (doc.status === 'declined' || doc.status === 'expired' || doc.status === 'converted') return false
    if (doc.status === 'accepted' && clean(doc.convertedInvoiceId)) return false
    return Boolean(clean(doc.quoteNumber) || typeof doc.total === 'number')
  },

  extractPriority(doc: QuoteDocument): BriefingPriority {
    if (doc.status === 'sent') return 'needs-peet'
    if (doc.status === 'accepted' && !clean(doc.convertedInvoiceId)) return 'needs-peet'
    if (doc.status === 'draft') return 'review'
    return 'fyi'
  },

  extractActor() {
    return {
      id: 'system',
      name: 'Sales',
      role: 'system' as const,
      type: 'system' as const,
    }
  },

  extractContext(doc: QuoteDocument, docId: string) {
    return {
      orgId: quoteOrgId(doc),
      quoteId: docId,
      quoteNumber: quoteNumber(doc, docId),
    }
  },

  extractTitle(doc: QuoteDocument, docId: string): string {
    const number = quoteNumber(doc, docId)
    if (doc.status === 'sent') return `Quote awaiting decision: ${number}`
    if (doc.status === 'accepted' && !clean(doc.convertedInvoiceId)) return `Accepted quote needs invoice: ${number}`
    if (doc.status === 'draft') return `Draft quote ready: ${number}`
    return `Quote needs review: ${number}`
  },

  extractSummary(doc: QuoteDocument): string {
    const parts: string[] = []
    const amount = money(doc.total, doc.currency)
    const recipient = recipientName(doc)
    const validUntil = isoDate(doc.validUntil)
    if (amount && recipient) parts.push(`${amount} quote for ${recipient}`)
    else if (amount) parts.push(`${amount} quote`)
    else if (recipient) parts.push(`Quote for ${recipient}`)
    if (doc.status) parts.push(`Status: ${doc.status}`)
    if (validUntil) parts.push(`Valid until: ${validUntil}`)
    const notes = extractMultiFieldExcerpt(doc, ['notes'], { maxLength: 120 })
    if (notes) parts.push(notes)
    return parts.join('. ') || 'Quote needs attention.'
  },

  extractExcerpt(doc: QuoteDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, notes: doc.notes }, ['summary', 'notes'], { maxLength })
  },

  extractOccurredAt(doc: QuoteDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.sentAt) ?? normalizeTimestamp(doc.acceptedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.validUntil)
  },

  extractMetadata(doc: QuoteDocument): Record<string, unknown> | null {
    return {
      quoteStatus: doc.status,
      total: doc.total,
      currency: doc.currency,
      validUntil: isoDate(doc.validUntil),
      recipientName: recipientName(doc),
      recipientEmail: clean(doc.recipientEmail) ?? clean(doc.clientDetails?.email),
      recipientOrgId: clean(doc.recipientOrgId),
      targetOrgId: clean(doc.targetOrgId),
      sourceOrgId: clean(doc.sourceOrgId) ?? clean(doc.orgId),
      convertedInvoiceId: clean(doc.convertedInvoiceId),
    }
  },

  toItem(doc: QuoteDocument, docId: string) {
    const orgId = quoteOrgId(doc)
    const priority = this.extractPriority(doc, docId)
    const actor = this.extractActor(doc, docId)
    const context = this.extractContext(doc, docId)
    const title = this.extractTitle(doc, docId)
    const summary = this.extractSummary(doc, docId)
    const excerpt = this.extractExcerpt(doc, docId)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const sourceHash = this.hashSource(doc, docId)
    const metadata = this.extractMetadata?.(doc, docId)

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/quotes/${encodeURIComponent(docId)}`,
      },
      priority,
      status: 'active',
      title,
      summary,
      excerpt,
      actor,
      context,
      occurredAt,
      sourceHash,
      metadata,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
