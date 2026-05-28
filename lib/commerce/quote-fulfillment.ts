import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { DealLineItem } from '@/lib/crm/types'
import type { LineItem } from '@/lib/invoices/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Quote } from '@/lib/quotes/types'

export interface QuoteFulfillmentInput {
  quoteId: string
  quote: Quote & Record<string, unknown>
  actor: MemberRef
}

export interface QuoteFulfillmentResult {
  orderId: string
  shipmentId?: string
  inventoryMovementId?: string
  created: boolean
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function lineCost(item: LineItem & Record<string, unknown>): number {
  const qty = numericValue(item.quantity)
  const unitCost = numericValue(item.unitCost ?? item.cost ?? item.costPrice)
  const explicitCost = numericValue(item.costTotal ?? item.totalCost)
  return explicitCost > 0 ? explicitCost : qty * unitCost
}

function toDealLineItem(item: LineItem & Record<string, unknown>, currency: Quote['currency']): DealLineItem {
  return {
    productId: cleanString(item.productId) || undefined,
    name: cleanString(item.description) || cleanString(item.name) || 'Quote line item',
    qty: numericValue(item.quantity),
    unitPrice: numericValue(item.unitPrice),
    total: numericValue(item.amount),
    currency,
  }
}

export async function createFulfillmentForAcceptedQuote(input: QuoteFulfillmentInput): Promise<QuoteFulfillmentResult> {
  const existingOrderId = cleanString(input.quote.fulfillmentOrderId)
  if (existingOrderId) return { orderId: existingOrderId, created: false }

  const quote = input.quote
  const orgId = cleanString(quote.sourceOrgId) || cleanString(quote.orgId)
  const companyId = cleanString(quote.companyId) || cleanString(quote.sourceCompanyId)
  if (!orgId) throw new Error('Quote source org is required for fulfillment')
  if (!companyId) throw new Error('Quote companyId is required for fulfillment')

  const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems as Array<LineItem & Record<string, unknown>> : []
  const subtotal = numericValue(quote.subtotal)
  const taxAmount = numericValue(quote.taxAmount)
  const total = numericValue(quote.total) || subtotal + taxAmount
  const costTotal = lineItems.reduce((sum, item) => sum + lineCost(item), 0)
  const grossProfit = total - costTotal
  const grossMargin = total > 0 ? Math.round((grossProfit / total) * 10000) / 100 : 0
  const now = FieldValue.serverTimestamp()

  const common = {
    orgId,
    companyId,
    contactId: cleanString(quote.contactId) || cleanString(quote.sourceContactId) || undefined,
    relationshipId: cleanString(quote.claimableRelationshipId) || undefined,
    quoteId: input.quoteId,
    visibility: 'relationship',
    allowedOrgIds: [orgId, cleanString(quote.recipientOrgId) || cleanString(quote.targetOrgId)].filter(Boolean),
    approvalState: 'approved',
    createdByRef: input.actor,
    updatedByRef: input.actor,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }

  const orderRef = await adminDb.collection('orders').add(Object.fromEntries(Object.entries({
    ...common,
    title: `Fulfillment for ${cleanString(quote.quoteNumber) || input.quoteId}`,
    status: 'confirmed',
    fulfillmentStatus: 'not_started',
    lineItems: lineItems.map((item) => toDealLineItem(item, quote.currency)),
    subtotal,
    taxAmount,
    total,
    currency: quote.currency,
    grossProfit,
    grossMargin,
  }).filter(([, value]) => value !== undefined)))

  const shipmentRef = await adminDb.collection('shipments').add(Object.fromEntries(Object.entries({
    ...common,
    orderId: orderRef.id,
    status: 'pending',
    notes: `Created when quote ${cleanString(quote.quoteNumber) || input.quoteId} was accepted.`,
  }).filter(([, value]) => value !== undefined)))

  const inventoryMovementRef = await adminDb.collection('inventoryMovements').add(Object.fromEntries(Object.entries({
    ...common,
    orderId: orderRef.id,
    shipmentId: shipmentRef.id,
    movementType: 'reserved',
    quantity: lineItems.reduce((sum, item) => sum + numericValue(item.quantity), 0),
    lineItems: lineItems.map((item) => toDealLineItem(item, quote.currency)),
  }).filter(([, value]) => value !== undefined)))

  await adminDb.collection('crmAuditEvents').add({
    orgId,
    eventType: 'quote.accepted.fulfillment_created',
    resourceType: 'quote',
    resourceId: input.quoteId,
    companyId,
    orderId: orderRef.id,
    shipmentId: shipmentRef.id,
    inventoryMovementId: inventoryMovementRef.id,
    actorRef: input.actor,
    createdAt: now,
  })

  await adminDb.collection('notifications').add({
    orgId,
    type: 'crm.quote.accepted.fulfillment_created',
    title: 'Quote fulfillment created',
    body: `Quote ${cleanString(quote.quoteNumber) || input.quoteId} was accepted and an order is ready to fulfil.`,
    resourceType: 'quote',
    resourceId: input.quoteId,
    companyId,
    orderId: orderRef.id,
    createdAt: now,
    read: false,
  })

  await adminDb.collection('quotes').doc(input.quoteId).update({
    fulfillmentOrderId: orderRef.id,
    fulfillmentShipmentId: shipmentRef.id,
    fulfillmentInventoryMovementId: inventoryMovementRef.id,
    fulfillmentStatus: 'not_started',
    updatedByRef: input.actor,
    updatedAt: now,
  })

  return {
    orderId: orderRef.id,
    shipmentId: shipmentRef.id,
    inventoryMovementId: inventoryMovementRef.id,
    created: true,
  }
}
