import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface ShipmentDocument extends Record<string, unknown> {
  orgId?: string | null
  companyId?: string | null
  orderId?: string | null
  serviceWorkspaceId?: string | null
  projectId?: string | null
  status?: string | null
  carrier?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  origin?: string | null
  destination?: string | null
  expectedDeliveryDate?: unknown
  deliveredAt?: unknown
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

function shipmentLabel(doc: ShipmentDocument, docId: string): string {
  return clean(doc.trackingNumber) ?? clean(doc.carrier) ?? docId
}

function sourceUrl(doc: ShipmentDocument, docId: string): string {
  const shipmentParam = `shipment=${encodeURIComponent(docId)}`
  const companyId = clean(doc.companyId)
  const projectId = clean(doc.projectId)
  if (companyId) return `/portal/companies/${encodeURIComponent(companyId)}?${shipmentParam}`
  if (projectId) return `/portal/projects/${encodeURIComponent(projectId)}?${shipmentParam}`
  return `/portal/crm?${shipmentParam}`
}

export const shipmentAdapter: BriefingSourceAdapter<ShipmentDocument> = {
  sourceType: 'shipment',
  collectionPath: 'shipments',

  hashSource(doc: ShipmentDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['status', 'carrier', 'trackingNumber', 'trackingUrl', 'expectedDeliveryDate', 'deliveredAt', 'updatedAt'])
  },

  shouldGenerate(doc: ShipmentDocument): boolean {
    if (doc.deleted === true) return false
    return doc.status !== 'delivered' && doc.status !== 'cancelled'
  },

  extractPriority(doc: ShipmentDocument): BriefingPriority {
    if (doc.status === 'failed') return 'critical'
    if (doc.status === 'pending') return 'needs-peet'
    if (doc.status === 'ready' || doc.status === 'in_transit') return 'review'
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

  extractContext(doc: ShipmentDocument, docId: string) {
    return {
      orgId: extractOrgId(doc) ?? '',
      companyId: clean(doc.companyId),
      projectId: clean(doc.projectId),
      orderId: clean(doc.orderId),
      shipmentId: docId,
      shipmentTrackingNumber: shipmentLabel(doc, docId),
    }
  },

  extractTitle(doc: ShipmentDocument, docId: string): string {
    const label = shipmentLabel(doc, docId)
    if (doc.status === 'failed') return `Shipment failed: ${label}`
    if (doc.status === 'ready') return `Shipment ready: ${label}`
    if (doc.status === 'in_transit') return `Shipment in transit: ${label}`
    if (doc.status === 'pending') return `Shipment pending: ${label}`
    return `Shipment needs review: ${label}`
  },

  extractSummary(doc: ShipmentDocument, docId: string): string {
    const label = shipmentLabel(doc, docId)
    const parts: string[] = []
    const carrier = clean(doc.carrier)
    const destination = clean(doc.destination)
    const expected = isoDate(doc.expectedDeliveryDate)
    if (carrier && clean(doc.trackingNumber)) parts.push(`${carrier} shipment ${label}`)
    else if (carrier) parts.push(`${carrier} shipment`)
    else parts.push(`Shipment ${label}`)
    if (doc.status) parts.push(`Status: ${doc.status}`)
    if (destination) parts.push(`Destination: ${destination}`)
    if (expected) parts.push(`Expected: ${expected}`)
    const notes = extractMultiFieldExcerpt(doc, ['notes'], { maxLength: 120 })
    if (notes) parts.push(notes)
    return parts.join('. ')
  },

  extractExcerpt(doc: ShipmentDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, notes: doc.notes, destination: doc.destination, trackingUrl: doc.trackingUrl }, ['summary', 'notes', 'destination', 'trackingUrl'], { maxLength })
  },

  extractOccurredAt(doc: ShipmentDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.expectedDeliveryDate)
  },

  extractMetadata(doc: ShipmentDocument): Record<string, unknown> | null {
    return {
      shipmentStatus: doc.status,
      carrier: clean(doc.carrier),
      trackingNumber: clean(doc.trackingNumber),
      trackingUrl: clean(doc.trackingUrl),
      origin: clean(doc.origin),
      destination: clean(doc.destination),
      expectedDeliveryDate: isoDate(doc.expectedDeliveryDate),
      deliveredAt: isoDate(doc.deliveredAt),
      companyId: clean(doc.companyId),
      orderId: clean(doc.orderId),
    }
  },

  toItem(doc: ShipmentDocument, docId: string) {
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
