/**
 * Source adapter for invoices.
 *
 * Brings billing risk and draft-send work into the Briefings control desk so
 * operators can catch overdue, pending, and ready-to-send invoices from one page.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface InvoiceDocument extends Record<string, unknown> {
  orgId?: string | null
  sourceOrgId?: string | null
  recipientOrgId?: string | null
  targetOrgId?: string | null
  invoiceNumber?: string | null
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
  publicToken?: string | null
  dueDate?: unknown
  sentAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
  paidAt?: unknown
  cancelledAt?: unknown
  paymentProofFileId?: string | null
  paymentProofUploadedAt?: unknown
  paymentProofNote?: string | null
  notes?: string | null
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

function invoiceNumber(doc: InvoiceDocument, docId: string): string {
  return clean(doc.invoiceNumber) ?? docId
}

function recipientName(doc: InvoiceDocument): string | null {
  return clean(doc.recipientName)
    ?? clean(doc.recipientCompanyName)
    ?? clean(doc.clientDetails?.name)
    ?? clean(doc.clientDetails?.email)
    ?? clean(doc.recipientEmail)
}

function invoiceOrgId(doc: InvoiceDocument): string {
  return clean(doc.sourceOrgId)
    ?? clean(doc.orgId)
    ?? clean(doc.recipientOrgId)
    ?? clean(doc.targetOrgId)
    ?? extractOrgId(doc)
    ?? ''
}

export const invoiceAdapter: BriefingSourceAdapter<InvoiceDocument> = {
  sourceType: 'invoice',
  collectionPath: 'invoices',

  hashSource(doc: InvoiceDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['invoiceNumber', 'status', 'total', 'currency', 'dueDate', 'updatedAt', 'sentAt'])
  },

  shouldGenerate(doc: InvoiceDocument): boolean {
    if (doc.status === 'paid' || doc.status === 'cancelled') return false
    return Boolean(clean(doc.invoiceNumber) || typeof doc.total === 'number')
  },

  extractPriority(doc: InvoiceDocument): BriefingPriority {
    if (doc.status === 'overdue') return 'client-risk'
    if (doc.status === 'payment_pending_verification') return 'needs-peet'
    if (doc.status === 'draft') return 'needs-peet'
    if (doc.status === 'partially_paid') return 'client-risk'
    if (doc.status === 'sent' || doc.status === 'viewed') return 'review'
    return 'fyi'
  },

  extractActor() {
    return {
      id: 'system',
      name: 'Billing',
      role: 'system' as const,
      type: 'system' as const,
    }
  },

  extractContext(doc: InvoiceDocument, docId: string) {
    return {
      orgId: invoiceOrgId(doc),
      invoiceId: docId,
      invoiceNumber: invoiceNumber(doc, docId),
    }
  },

  extractTitle(doc: InvoiceDocument, docId: string): string {
    const number = invoiceNumber(doc, docId)
    if (doc.status === 'overdue') return `Overdue invoice: ${number}`
    if (doc.status === 'payment_pending_verification') return `Payment proof needs review: ${number}`
    if (doc.status === 'draft') return `Draft invoice ready: ${number}`
    if (doc.status === 'partially_paid') return `Part-paid invoice needs follow-up: ${number}`
    if (doc.status === 'viewed') return `Invoice viewed: ${number}`
    if (doc.status === 'sent') return `Invoice awaiting payment: ${number}`
    return `Invoice needs review: ${number}`
  },

  extractSummary(doc: InvoiceDocument): string {
    const parts: string[] = []
    const amount = money(doc.total, doc.currency)
    const recipient = recipientName(doc)
    const due = isoDate(doc.dueDate)
    if (amount && recipient) parts.push(`${amount} invoice for ${recipient}`)
    else if (amount) parts.push(`${amount} invoice`)
    else if (recipient) parts.push(`Invoice for ${recipient}`)
    if (doc.status) parts.push(`Status: ${doc.status}`)
    if (due) parts.push(`Due: ${due}`)
    const notes = extractMultiFieldExcerpt(doc, ['paymentProofNote', 'notes'], { maxLength: 120 })
    if (notes) parts.push(notes)
    return parts.join('. ') || 'Invoice needs attention.'
  },

  extractExcerpt(doc: InvoiceDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, paymentProofNote: doc.paymentProofNote, notes: doc.notes }, ['summary', 'paymentProofNote', 'notes'], { maxLength })
  },

  extractOccurredAt(doc: InvoiceDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.sentAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.dueDate)
  },

  extractMetadata(doc: InvoiceDocument): Record<string, unknown> | null {
    return {
      invoiceStatus: doc.status,
      total: doc.total,
      currency: doc.currency,
      dueDate: isoDate(doc.dueDate),
      publicToken: doc.publicToken,
      recipientName: recipientName(doc),
      recipientEmail: clean(doc.recipientEmail) ?? clean(doc.clientDetails?.email),
      recipientOrgId: clean(doc.recipientOrgId),
      targetOrgId: clean(doc.targetOrgId),
      paymentProofFileId: clean(doc.paymentProofFileId),
      paymentProofUploadedAt: isoDate(doc.paymentProofUploadedAt),
    }
  },

  toItem(doc: InvoiceDocument, docId: string) {
    const orgId = invoiceOrgId(doc)
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
        url: `/admin/invoicing/${encodeURIComponent(docId)}`,
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
