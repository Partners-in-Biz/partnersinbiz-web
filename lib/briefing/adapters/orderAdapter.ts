import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface OrderDocument extends Record<string, unknown> {
  orgId?: string | null
  companyId?: string | null
  contactId?: string | null
  relationshipId?: string | null
  serviceWorkspaceId?: string | null
  projectId?: string | null
  dealId?: string | null
  quoteId?: string | null
  invoiceId?: string | null
  title?: string | null
  status?: string | null
  fulfillmentStatus?: string | null
  total?: number | null
  currency?: string | null
  expectedDeliveryDate?: unknown
  deliveredAt?: unknown
  approvalState?: string | null
  notes?: string | null
  deleted?: boolean | null
  createdAt?: unknown
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isoDate(value: unknown): string | null {
  const date = normalizeTimestamp(value)
  return date ? date.toISOString().slice(0, 10) : null
}

function money(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  const code = clean(currency) ?? 'ZAR'
  const symbol = code === 'ZAR' ? 'R' : code === 'USD' ? '$' : code === 'EUR' ? '€' : `${code} `
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function orderLabel(doc: OrderDocument, docId: string): string {
  return clean(doc.title) ?? docId
}

function sourceUrl(doc: OrderDocument, docId: string): string {
  const orderParam = `order=${encodeURIComponent(docId)}`
  const companyId = clean(doc.companyId)
  const projectId = clean(doc.projectId)
  if (companyId) return `/portal/companies/${encodeURIComponent(companyId)}?${orderParam}`
  if (projectId) return `/portal/projects/${encodeURIComponent(projectId)}?${orderParam}`
  return `/portal/crm?${orderParam}`
}

export const orderAdapter: BriefingSourceAdapter<OrderDocument> = {
  sourceType: 'order',
  collectionPath: 'orders',

  hashSource(doc: OrderDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['status', 'fulfillmentStatus', 'approvalState', 'total', 'expectedDeliveryDate', 'deliveredAt', 'updatedAt'])
  },

  shouldGenerate(doc: OrderDocument): boolean {
    if (doc.deleted === true) return false
    return doc.status !== 'fulfilled' && doc.status !== 'cancelled' && doc.status !== 'archived'
  },

  extractPriority(doc: OrderDocument): BriefingPriority {
    if (doc.fulfillmentStatus === 'blocked') return 'critical'
    if (doc.approvalState === 'pending_approval' || doc.status === 'draft') return 'needs-peet'
    if (doc.status === 'confirmed' || doc.status === 'in_progress') return 'review'
    return 'fyi'
  },

  extractActor() {
    return {
      id: 'system',
      name: 'Fulfillment',
      role: 'system' as const,
      type: 'system' as const,
    }
  },

  extractContext(doc: OrderDocument, docId: string) {
    return {
      orgId: extractOrgId(doc) ?? '',
      companyId: clean(doc.companyId),
      contactId: clean(doc.contactId),
      projectId: clean(doc.projectId) ?? clean(doc.serviceWorkspaceId),
      dealId: clean(doc.dealId),
      quoteId: clean(doc.quoteId),
      invoiceId: clean(doc.invoiceId),
      orderId: docId,
      orderTitle: orderLabel(doc, docId),
    }
  },

  extractTitle(doc: OrderDocument, docId: string): string {
    const label = orderLabel(doc, docId)
    if (doc.fulfillmentStatus === 'blocked') return `Order blocked: ${label}`
    if (doc.status === 'draft') return `Draft order ready: ${label}`
    if (doc.status === 'confirmed') return `Order ready to start: ${label}`
    if (doc.status === 'in_progress') return `Order in progress: ${label}`
    return `Order needs review: ${label}`
  },

  extractSummary(doc: OrderDocument): string {
    const parts: string[] = []
    const formattedTotal = money(doc.total, doc.currency)
    const expected = isoDate(doc.expectedDeliveryDate)
    if (formattedTotal) parts.push(`${formattedTotal} order`)
    else parts.push('Order')
    if (doc.status) parts.push(`Status: ${doc.status}`)
    if (doc.fulfillmentStatus) parts.push(`Fulfillment: ${doc.fulfillmentStatus}`)
    if (expected) parts.push(`Expected: ${expected}`)
    const notes = extractMultiFieldExcerpt(doc, ['notes'], { maxLength: 120 })
    if (notes) parts.push(notes)
    return parts.join('. ')
  },

  extractExcerpt(doc: OrderDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, notes: doc.notes }, ['summary', 'notes'], { maxLength })
  },

  extractOccurredAt(doc: OrderDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.expectedDeliveryDate)
  },

  extractMetadata(doc: OrderDocument): Record<string, unknown> | null {
    return {
      orderStatus: doc.status,
      fulfillmentStatus: doc.fulfillmentStatus,
      approvalState: clean(doc.approvalState),
      total: doc.total,
      currency: clean(doc.currency) ?? 'ZAR',
      expectedDeliveryDate: isoDate(doc.expectedDeliveryDate),
      deliveredAt: isoDate(doc.deliveredAt),
      companyId: clean(doc.companyId),
      contactId: clean(doc.contactId),
      projectId: clean(doc.projectId) ?? clean(doc.serviceWorkspaceId),
      dealId: clean(doc.dealId),
      quoteId: clean(doc.quoteId),
      invoiceId: clean(doc.invoiceId),
    }
  },

  toItem(doc: OrderDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
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
        url: sourceUrl(doc, docId),
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
