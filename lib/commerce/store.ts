import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import type { CommerceListParams, InventoryItem, Order, Shipment } from './types'
import type { Currency, DealLineItem } from '@/lib/crm/types'

type CommerceKind = 'orders' | 'shipments' | 'inventoryItems'
type CommerceRow = Order | Shipment | InventoryItem

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter(Boolean)
}

function numericValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function limitValue(value: unknown, fallback = 100): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), 500)
}

function timeValue(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function sanitizeCommon(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const key of [
    'companyId',
    'contactId',
    'relationshipId',
    'serviceWorkspaceId',
    'dealId',
    'quoteId',
    'invoiceId',
    'projectId',
    'orderId',
    'status',
    'fulfillmentStatus',
    'visibility',
    'approvalState',
    'notes',
  ]) {
    const value = cleanString(input[key])
    if (value) out[key] = value
  }
  const allowedOrgIds = cleanStringArray(input.allowedOrgIds)
  if (allowedOrgIds.length > 0) out.allowedOrgIds = allowedOrgIds
  const allowedUserIds = cleanStringArray(input.allowedUserIds)
  if (allowedUserIds.length > 0) out.allowedUserIds = allowedUserIds
  if (input.expectedDeliveryDate !== undefined) out.expectedDeliveryDate = input.expectedDeliveryDate
  if (input.deliveredAt !== undefined) out.deliveredAt = input.deliveredAt
  return out
}

function sanitizeOrder(input: Record<string, unknown>) {
  const lineItems = Array.isArray(input.lineItems) ? input.lineItems as DealLineItem[] : []
  const subtotal = numericValue(input.subtotal, lineItems.reduce((total, item) => total + numericValue(item.total), 0))
  const taxAmount = numericValue(input.taxAmount)
  const total = numericValue(input.total, subtotal + taxAmount)
  return {
    ...sanitizeCommon(input),
    title: cleanString(input.title) || cleanString(input.name) || 'Untitled order',
    lineItems,
    subtotal,
    taxAmount,
    total,
    currency: (cleanString(input.currency) || 'ZAR') as Currency,
  }
}

function sanitizeShipment(input: Record<string, unknown>) {
  return {
    ...sanitizeCommon(input),
    carrier: cleanString(input.carrier),
    trackingNumber: cleanString(input.trackingNumber),
    trackingUrl: cleanString(input.trackingUrl),
    origin: cleanString(input.origin),
    destination: cleanString(input.destination),
  }
}

function sanitizeInventoryItem(input: Record<string, unknown>) {
  return {
    ...sanitizeCommon(input),
    productId: cleanString(input.productId),
    name: cleanString(input.name) || cleanString(input.sku) || 'Inventory item',
    sku: cleanString(input.sku),
    quantityAvailable: numericValue(input.quantityAvailable),
    quantityReserved: numericValue(input.quantityReserved),
    lowStockThreshold: numericValue(input.lowStockThreshold),
    unit: cleanString(input.unit),
    location: cleanString(input.location),
  }
}

function sanitize(kind: CommerceKind, input: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'orders') return sanitizeOrder(input)
  if (kind === 'shipments') return sanitizeShipment(input)
  return sanitizeInventoryItem(input)
}

function resourceType(kind: CommerceKind): string {
  if (kind === 'orders') return 'order'
  if (kind === 'shipments') return 'shipment'
  return 'inventoryItem'
}

function notificationFor(kind: CommerceKind, action: 'created' | 'updated', row: CommerceRow) {
  if (kind === 'shipments') {
    return {
      type: `crm.shipment.${action}`,
      title: action === 'created' ? 'Shipment created' : 'Shipment updated',
      body: row.status ? `Shipment status is ${row.status}.` : 'Shipment tracking changed.',
    }
  }
  if (row.approvalState === 'pending_approval') {
    return {
      type: `crm.${resourceType(kind)}.approval_pending`,
      title: 'Approval required',
      body: `A ${resourceType(kind)} change is waiting for approval.`,
    }
  }
  return undefined
}

function defaultFields(kind: CommerceKind, data: Record<string, unknown>) {
  if (kind === 'orders') {
    return {
      status: data.status || 'draft',
      fulfillmentStatus: data.fulfillmentStatus || 'not_started',
    }
  }
  if (kind === 'shipments') return { status: data.status || 'pending' }
  const quantityAvailable = numericValue(data.quantityAvailable)
  const lowStockThreshold = numericValue(data.lowStockThreshold)
  return {
    status: data.status || (lowStockThreshold > 0 && quantityAvailable <= lowStockThreshold ? 'low_stock' : 'active'),
    quantityAvailable,
    quantityReserved: numericValue(data.quantityReserved),
  }
}

function matchesRow(row: CommerceRow, params: CommerceListParams): boolean {
  if (row.deleted === true || row.status === 'archived') return false
  if (params.companyId && row.companyId !== params.companyId) return false
  if (params.serviceWorkspaceId && row.serviceWorkspaceId !== params.serviceWorkspaceId) return false
  if (params.projectId && (!('projectId' in row) || row.projectId !== params.projectId)) return false
  if (params.orderId && 'orderId' in row && row.orderId !== params.orderId) return false
  if (params.status && row.status !== params.status) return false
  return true
}

async function listRows<T extends CommerceRow>(
  kind: CommerceKind,
  orgId: string,
  params: CommerceListParams = {},
): Promise<T[]> {
  const snap = await adminDb.collection(kind).where('orgId', '==', orgId).limit(1000).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as T)
    .filter((row) => matchesRow(row, params))
    .sort((a, b) => timeValue(b.updatedAt ?? b.createdAt) - timeValue(a.updatedAt ?? a.createdAt))
    .slice(0, limitValue(params.limit))
}

async function createRow<T extends CommerceRow>(
  kind: CommerceKind,
  orgId: string,
  input: Record<string, unknown>,
  actor: MemberRef,
): Promise<T> {
  const sanitized = sanitize(kind, input)
  if (kind !== 'inventoryItems' && !sanitized.companyId) throw new Error('companyId is required')
  const ref = await adminDb.collection(kind).add({
    ...sanitized,
    ...defaultFields(kind, sanitized),
    orgId,
    visibility: sanitized.visibility || 'relationship',
    approvalState: sanitized.approvalState || 'approved',
    createdByRef: actor,
    updatedByRef: actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  const snap = await ref.get()
  const row = { id: ref.id, ...snap.data() } as T
  await recordCrmAuditEvent({
    orgId,
    eventType: `${resourceType(kind)}.created`,
    resourceType: resourceType(kind),
    resourceId: ref.id,
    companyId: row.companyId,
    relationshipId: 'relationshipId' in row ? row.relationshipId : undefined,
    serviceWorkspaceId: row.serviceWorkspaceId,
    orderId: kind === 'orders' ? row.id : ('orderId' in row ? row.orderId : undefined),
    shipmentId: kind === 'shipments' ? row.id : undefined,
    approvalState: row.approvalState,
    actorRef: actor,
    metadata: { status: row.status },
    notification: notificationFor(kind, 'created', row),
  })
  return row
}

async function updateRow<T extends CommerceRow>(
  kind: CommerceKind,
  orgId: string,
  id: string,
  input: Record<string, unknown>,
  actor: MemberRef,
): Promise<T> {
  const ref = adminDb.collection(kind).doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`${kind} record not found`)
  const existing = snap.data() as CommerceRow
  if (existing.orgId !== orgId) throw new Error(`${kind} record not found`)
  const sanitized = sanitize(kind, input)
  await ref.update({
    ...sanitized,
    updatedByRef: actor,
    updatedAt: FieldValue.serverTimestamp(),
  })
  const next = await ref.get()
  const row = { id, ...next.data() } as T
  await recordCrmAuditEvent({
    orgId,
    eventType: `${resourceType(kind)}.updated`,
    resourceType: resourceType(kind),
    resourceId: id,
    companyId: row.companyId,
    relationshipId: 'relationshipId' in row ? row.relationshipId : undefined,
    serviceWorkspaceId: row.serviceWorkspaceId,
    orderId: kind === 'orders' ? row.id : ('orderId' in row ? row.orderId : undefined),
    shipmentId: kind === 'shipments' ? row.id : undefined,
    approvalState: row.approvalState,
    actorRef: actor,
    metadata: sanitized,
    notification: notificationFor(kind, 'updated', row),
  })
  return row
}

export function listOrders(orgId: string, params?: CommerceListParams) {
  return listRows<Order>('orders', orgId, params)
}

export function createOrder(orgId: string, input: Record<string, unknown>, actor: MemberRef) {
  return createRow<Order>('orders', orgId, input, actor)
}

export function updateOrder(orgId: string, id: string, input: Record<string, unknown>, actor: MemberRef) {
  return updateRow<Order>('orders', orgId, id, input, actor)
}

export function listShipments(orgId: string, params?: CommerceListParams) {
  return listRows<Shipment>('shipments', orgId, params)
}

export function createShipment(orgId: string, input: Record<string, unknown>, actor: MemberRef) {
  return createRow<Shipment>('shipments', orgId, input, actor)
}

export function updateShipment(orgId: string, id: string, input: Record<string, unknown>, actor: MemberRef) {
  return updateRow<Shipment>('shipments', orgId, id, input, actor)
}

export function listInventoryItems(orgId: string, params?: CommerceListParams) {
  return listRows<InventoryItem>('inventoryItems', orgId, params)
}

export function createInventoryItem(orgId: string, input: Record<string, unknown>, actor: MemberRef) {
  return createRow<InventoryItem>('inventoryItems', orgId, input, actor)
}

export function updateInventoryItem(orgId: string, id: string, input: Record<string, unknown>, actor: MemberRef) {
  return updateRow<InventoryItem>('inventoryItems', orgId, id, input, actor)
}
