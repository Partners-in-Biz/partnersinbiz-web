import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface InventoryItemDocument extends Record<string, unknown> {
  orgId?: string | null
  companyId?: string | null
  productId?: string | null
  serviceWorkspaceId?: string | null
  projectId?: string | null
  name?: string | null
  sku?: string | null
  status?: string | null
  quantityAvailable?: number | null
  quantityReserved?: number | null
  lowStockThreshold?: number | null
  unit?: string | null
  location?: string | null
  notes?: string | null
  deleted?: boolean | null
  createdAt?: unknown
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function inventoryLabel(doc: InventoryItemDocument, docId: string): string {
  return clean(doc.name) ?? clean(doc.sku) ?? docId
}

function sourceUrl(doc: InventoryItemDocument, docId: string): string {
  const inventoryParam = `inventory=${encodeURIComponent(docId)}`
  const companyId = clean(doc.companyId)
  const projectId = clean(doc.projectId) ?? clean(doc.serviceWorkspaceId)
  if (companyId) return `/portal/companies/${encodeURIComponent(companyId)}?${inventoryParam}`
  if (projectId) return `/portal/projects/${encodeURIComponent(projectId)}?${inventoryParam}`
  return `/portal/crm?${inventoryParam}`
}

function isLowStock(doc: InventoryItemDocument): boolean {
  if (doc.status === 'low_stock' || doc.status === 'out_of_stock') return true
  const threshold = numeric(doc.lowStockThreshold)
  return threshold > 0 && numeric(doc.quantityAvailable) <= threshold
}

export const inventoryItemAdapter: BriefingSourceAdapter<InventoryItemDocument> = {
  sourceType: 'inventory-item',
  collectionPath: 'inventoryItems',

  hashSource(doc: InventoryItemDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'sku', 'status', 'quantityAvailable', 'quantityReserved', 'lowStockThreshold', 'updatedAt'])
  },

  shouldGenerate(doc: InventoryItemDocument): boolean {
    if (doc.deleted === true || doc.status === 'archived') return false
    return isLowStock(doc)
  },

  extractPriority(doc: InventoryItemDocument): BriefingPriority {
    if (doc.status === 'out_of_stock' || numeric(doc.quantityAvailable) <= 0) return 'critical'
    return 'client-risk'
  },

  extractActor() {
    return {
      id: 'system',
      name: 'Inventory',
      role: 'system' as const,
      type: 'system' as const,
    }
  },

  extractContext(doc: InventoryItemDocument, docId: string) {
    return {
      orgId: extractOrgId(doc) ?? '',
      companyId: clean(doc.companyId),
      projectId: clean(doc.projectId) ?? clean(doc.serviceWorkspaceId),
      inventoryItemId: docId,
      inventoryItemName: inventoryLabel(doc, docId),
    }
  },

  extractTitle(doc: InventoryItemDocument, docId: string): string {
    const label = inventoryLabel(doc, docId)
    if (doc.status === 'out_of_stock' || numeric(doc.quantityAvailable) <= 0) return `Out of stock: ${label}`
    return `Low stock: ${label}`
  },

  extractSummary(doc: InventoryItemDocument): string {
    const unit = clean(doc.unit) ?? 'units'
    const parts: string[] = []
    parts.push(`${numeric(doc.quantityAvailable)} ${unit} available`)
    parts.push(`${numeric(doc.quantityReserved)} reserved`)
    if (numeric(doc.lowStockThreshold) > 0) parts.push(`Threshold: ${numeric(doc.lowStockThreshold)}`)
    const sku = clean(doc.sku)
    const location = clean(doc.location)
    if (sku) parts.push(`SKU: ${sku}`)
    if (location) parts.push(`Location: ${location}`)
    const notes = extractMultiFieldExcerpt(doc, ['notes'], { maxLength: 120 })
    if (notes) parts.push(notes)
    return parts.join('. ')
  },

  extractExcerpt(doc: InventoryItemDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, notes: doc.notes, location: doc.location }, ['summary', 'notes', 'location'], { maxLength })
  },

  extractOccurredAt(doc: InventoryItemDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: InventoryItemDocument): Record<string, unknown> | null {
    return {
      inventoryStatus: doc.status,
      quantityAvailable: numeric(doc.quantityAvailable),
      quantityReserved: numeric(doc.quantityReserved),
      lowStockThreshold: numeric(doc.lowStockThreshold),
      unit: clean(doc.unit),
      sku: clean(doc.sku),
      location: clean(doc.location),
      companyId: clean(doc.companyId),
      productId: clean(doc.productId),
      projectId: clean(doc.projectId) ?? clean(doc.serviceWorkspaceId),
    }
  },

  toItem(doc: InventoryItemDocument, docId: string) {
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
