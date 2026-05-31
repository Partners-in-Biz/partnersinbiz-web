/**
 * Source adapter for expenses.
 *
 * Turns submitted expenses into review cards so admin users can approve or
 * reject reimbursement and billable-cost work from the Briefings desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface ExpenseDocument extends Record<string, unknown> {
  orgId?: string | null
  userId?: string | null
  date?: unknown
  amount?: number | null
  currency?: string | null
  category?: string | null
  description?: string | null
  vendor?: string | null
  receiptFileId?: string | null
  projectId?: string | null
  clientOrgId?: string | null
  billable?: boolean | null
  reimbursable?: boolean | null
  status?: string | null
  invoiceId?: string | null
  createdAt?: unknown
  updatedAt?: unknown
  submittedAt?: unknown
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

function category(doc: ExpenseDocument, docId: string): string {
  return clean(doc.category) ?? docId
}

function expenseOrgId(doc: ExpenseDocument): string {
  return clean(doc.orgId) ?? clean(doc.clientOrgId) ?? extractOrgId(doc) ?? ''
}

export const expenseAdapter: BriefingSourceAdapter<ExpenseDocument> = {
  sourceType: 'expense',
  collectionPath: 'expenses',

  hashSource(doc: ExpenseDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['status', 'amount', 'currency', 'category', 'vendor', 'date', 'updatedAt', 'submittedAt'])
  },

  shouldGenerate(doc: ExpenseDocument): boolean {
    if (doc.deleted === true) return false
    return doc.status === 'submitted'
  },

  extractPriority(): BriefingPriority {
    return 'needs-peet'
  },

  extractActor(doc: ExpenseDocument) {
    const userId = clean(doc.userId)
    return {
      id: userId ? `user:${userId}` : 'unknown',
      role: userId ? 'client' as const : undefined,
      type: userId ? 'user' as const : 'system' as const,
    }
  },

  extractContext(doc: ExpenseDocument, docId: string) {
    return {
      orgId: expenseOrgId(doc),
      projectId: clean(doc.projectId),
      expenseId: docId,
      expenseCategory: category(doc, docId),
    }
  },

  extractTitle(doc: ExpenseDocument, docId: string): string {
    return `Expense needs approval: ${category(doc, docId)}`
  },

  extractSummary(doc: ExpenseDocument): string {
    const parts: string[] = []
    const amount = money(doc.amount, doc.currency)
    const vendor = clean(doc.vendor)
    const date = isoDate(doc.date)
    if (amount && vendor) parts.push(`${amount} expense from ${vendor}`)
    else if (amount) parts.push(`${amount} expense`)
    else if (vendor) parts.push(`Expense from ${vendor}`)
    if (date) parts.push(`Date: ${date}`)
    if (doc.billable === true) parts.push('Billable')
    if (doc.reimbursable === true) parts.push('Reimbursable')
    const description = extractMultiFieldExcerpt(doc, ['description'], { maxLength: 120 })
    if (description) parts.push(description)
    return parts.join('. ') || 'Submitted expense needs review.'
  },

  extractExcerpt(doc: ExpenseDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, description: doc.description }, ['summary', 'description'], { maxLength })
  },

  extractOccurredAt(doc: ExpenseDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.submittedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.date)
  },

  extractMetadata(doc: ExpenseDocument): Record<string, unknown> | null {
    return {
      expenseStatus: doc.status,
      amount: doc.amount,
      currency: doc.currency,
      vendor: clean(doc.vendor),
      date: isoDate(doc.date),
      billable: doc.billable === true,
      reimbursable: doc.reimbursable === true,
      receiptFileId: clean(doc.receiptFileId),
      clientOrgId: clean(doc.clientOrgId),
      invoiceId: clean(doc.invoiceId),
    }
  },

  toItem(doc: ExpenseDocument, docId: string) {
    const orgId = expenseOrgId(doc)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/finance?expense=${encodeURIComponent(docId)}`,
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
