import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import type { BusinessRelationship, SharedBusinessCapability } from '@/lib/business-relationships/types'
import type { Currency, DealLineItem } from '@/lib/crm/types'
import { cleanString } from './identity'
import { grantSystemShare } from './shares'

/**
 * Cross-org trading over an accepted partner link.
 *
 * A supplier publishes selected products to ONE partner at a negotiated price
 * (`partner_catalog_items`). The buyer browses that catalogue and submits an
 * order, which lands as a PENDING sales order in the supplier's workspace plus
 * a mirrored purchase order in the buyer's — two `orders` rows sharing a
 * `tradeOrderId`, the same pattern `partnerLinkId` uses for the link itself.
 * The supplier confirms, which reserves stock and drafts an invoice.
 *
 * Deliberate data-flow choice: catalogue rows are written BY the supplier and
 * stamped with `buyerOrgId`, so the buyer reads its own tenant's rows. Browsing
 * a catalogue is therefore NOT a cross-org read. The only cross-org read here
 * is the stock signal (see `stockSignalFor`), which returns one of three
 * strings and never a quantity.
 */

export const CATALOG_COLLECTION = 'partner_catalog_items'
export const ORDERS_COLLECTION = 'orders'

export type StockSignal = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'
export type PartnerOrderStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'
export type PartnerOrderDirection = 'purchase' | 'sales'

export interface PartnerCatalogItem {
  id: string
  partnerLinkId: string
  relationshipId: string
  supplierOrgId: string
  buyerOrgId: string
  productId: string
  // Snapshot taken at publish time so the buyer never reads the supplier's
  // product row, and so a later price change does not silently rewrite history.
  name: string
  sku?: string
  unit?: string
  description?: string
  unitPrice: number
  currency: Currency
  taxRate?: number
  active: boolean
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  createdAt?: unknown
  updatedAt?: unknown
  deleted?: boolean
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

function toItem(id: string, data: Record<string, unknown>): PartnerCatalogItem {
  return { id, ...(data as Omit<PartnerCatalogItem, 'id'>) }
}

/** Loads the caller's own side of an accepted, active partner link. */
async function loadActiveLink(relationshipId: string, ownerOrgId: string): Promise<BusinessRelationship> {
  const snap = await adminDb.collection('businessRelationships').doc(relationshipId).get()
  if (!snap.exists) throw new Error('Partner link not found')
  const link = { ...(snap.data() as BusinessRelationship), id: snap.id }
  if (link.sourceOrgId !== ownerOrgId || link.deleted === true) throw new Error('Partner link not found')
  if (!cleanString(link.partnerLinkId)) throw new Error('That relationship is not an accepted partner link')
  if (link.status !== 'active') throw new Error('This partner link is not active')
  if (!cleanString(link.targetOrgId)) throw new Error('This partner link has no counterpart organisation')
  return link
}

function requireCapability(link: BusinessRelationship, capability: SharedBusinessCapability): void {
  if (!link.sharedCapabilities?.includes(capability)) {
    throw new Error(`This partner link does not share "${capability}". Enable it on the Partners page first.`)
  }
}

// ── Catalogue (supplier side) ────────────────────────────────────────────────

export async function publishCatalogItem(input: {
  supplierOrgId: string
  relationshipId: string
  productId: string
  unitPrice?: number
  actor: MemberRef
}): Promise<PartnerCatalogItem> {
  const link = await loadActiveLink(input.relationshipId, input.supplierOrgId)
  requireCapability(link, 'orders')
  const buyerOrgId = cleanString(link.targetOrgId)

  const productSnap = await adminDb.collection('products').doc(input.productId).get()
  if (!productSnap.exists) throw new Error('Product not found')
  const product = productSnap.data() ?? {}
  if (product.orgId !== input.supplierOrgId || product.deleted === true) throw new Error('Product not found')

  const unitPrice = typeof input.unitPrice === 'number' && Number.isFinite(input.unitPrice) && input.unitPrice >= 0
    ? input.unitPrice
    : Number(product.unitPrice) || 0

  const now = FieldValue.serverTimestamp()
  const existingSnap = await adminDb
    .collection(CATALOG_COLLECTION)
    .where('supplierOrgId', '==', input.supplierOrgId)
    .where('buyerOrgId', '==', buyerOrgId)
    .where('productId', '==', input.productId)
    .limit(1)
    .get()

  const payload = stripUndefined({
    partnerLinkId: link.partnerLinkId,
    relationshipId: input.relationshipId,
    supplierOrgId: input.supplierOrgId,
    buyerOrgId,
    productId: input.productId,
    name: cleanString(product.name) || 'Unnamed product',
    sku: cleanString(product.sku) || undefined,
    unit: cleanString(product.unit) || undefined,
    description: cleanString(product.description) || undefined,
    unitPrice,
    currency: (cleanString(product.currency) || 'ZAR') as Currency,
    taxRate: typeof product.taxRate === 'number' ? product.taxRate : undefined,
    active: true,
    updatedByRef: input.actor,
    updatedAt: now,
    deleted: false,
  })

  if (!existingSnap.empty) {
    const doc = existingSnap.docs[0]
    await doc.ref.set(payload, { merge: true })
    const fresh = await doc.ref.get()
    return toItem(doc.id, fresh.data() ?? {})
  }

  const ref = await adminDb.collection(CATALOG_COLLECTION).add({
    ...payload,
    createdByRef: input.actor,
    createdAt: now,
  })
  const saved = await ref.get()
  return toItem(ref.id, saved.data() ?? {})
}

export async function unpublishCatalogItem(input: {
  supplierOrgId: string
  itemId: string
  actor: MemberRef
}): Promise<void> {
  const ref = adminDb.collection(CATALOG_COLLECTION).doc(input.itemId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Catalogue item not found')
  const item = toItem(snap.id, snap.data() ?? {})
  if (item.supplierOrgId !== input.supplierOrgId) throw new Error('Catalogue item not found')
  await ref.set({
    active: false,
    deleted: true,
    updatedByRef: input.actor,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

/** What the supplier has published to one partner. */
export async function listPublishedCatalog(input: {
  supplierOrgId: string
  relationshipId?: string
}): Promise<PartnerCatalogItem[]> {
  const snap = await adminDb
    .collection(CATALOG_COLLECTION)
    .where('supplierOrgId', '==', input.supplierOrgId)
    .limit(1000)
    .get()

  return snap.docs
    .map((d) => toItem(d.id, d.data() ?? {}))
    .filter((i) => i.deleted !== true)
    .filter((i) => (input.relationshipId ? i.relationshipId === input.relationshipId : true))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Stock signal ─────────────────────────────────────────────────────────────

/**
 * SANCTIONED CROSS-ORG READ (third location, narrowest contract).
 *
 * Reads the supplier's `inventoryItems` for one product and returns ONLY a
 * coarse availability signal. Quantities never leave the supplier's tenant.
 * Requires the link to share the `inventory` capability; without it every
 * product reports 'unknown'.
 */
async function stockSignalFor(input: {
  supplierOrgId: string
  productIds: string[]
  includeStock: boolean
}): Promise<Record<string, StockSignal>> {
  const out: Record<string, StockSignal> = {}
  for (const id of input.productIds) out[id] = 'unknown'
  if (!input.includeStock || input.productIds.length === 0) return out

  const snap = await adminDb
    .collection('inventoryItems')
    .where('orgId', '==', input.supplierOrgId)
    .limit(1000)
    .get()

  const wanted = new Set(input.productIds)
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    if (data.deleted === true) continue
    const productId = cleanString(data.productId)
    if (!productId || !wanted.has(productId)) continue

    const available = Number(data.quantityAvailable) || 0
    const threshold = typeof data.lowStockThreshold === 'number' ? data.lowStockThreshold : 0
    const signal: StockSignal = available <= 0
      ? 'out_of_stock'
      : (threshold > 0 && available <= threshold ? 'low_stock' : 'in_stock')

    // A product can span several inventory rows; take the most optimistic.
    const rank: Record<StockSignal, number> = { out_of_stock: 0, low_stock: 1, in_stock: 2, unknown: -1 }
    if (rank[signal] > rank[out[productId]]) out[productId] = signal
  }
  return out
}

export interface BuyableCatalogItem extends PartnerCatalogItem {
  stock: StockSignal
}

/**
 * What a buyer can order from one linked supplier. Reads rows in the buyer's
 * own tenant (`buyerOrgId ==`), so this is not a cross-org read; only the stock
 * signal crosses, and only as a coarse status.
 */
export async function browsePartnerCatalog(input: {
  buyerOrgId: string
  relationshipId: string
}): Promise<{ items: BuyableCatalogItem[]; supplierOrgId: string; supplierName: string }> {
  // The buyer's own side of the link tells us who the supplier is.
  const link = await loadActiveLink(input.relationshipId, input.buyerOrgId)
  const supplierOrgId = cleanString(link.targetOrgId)

  const snap = await adminDb
    .collection(CATALOG_COLLECTION)
    .where('buyerOrgId', '==', input.buyerOrgId)
    .where('supplierOrgId', '==', supplierOrgId)
    .limit(1000)
    .get()

  const rows = snap.docs
    .map((d) => toItem(d.id, d.data() ?? {}))
    .filter((i) => i.deleted !== true && i.active !== false)

  const stock = await stockSignalFor({
    supplierOrgId,
    productIds: rows.map((r) => r.productId),
    includeStock: Boolean(link.sharedCapabilities?.includes('inventory')),
  })

  const orgSnap = await adminDb.collection('organizations').doc(supplierOrgId).get()
  const supplierName = cleanString((orgSnap.data() ?? {}).name) || supplierOrgId

  return {
    items: rows
      .map((r) => ({ ...r, stock: stock[r.productId] ?? 'unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    supplierOrgId,
    supplierName,
  }
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface PlacePartnerOrderInput {
  buyerOrgId: string
  relationshipId: string
  lines: Array<{ catalogItemId: string; qty: number }>
  notes?: string
  actor: MemberRef
}

export interface PartnerOrderPair {
  tradeOrderId: string
  buyerOrderId: string
  supplierOrderId: string
  total: number
  currency: Currency
}

/**
 * Buyer submits. Writes a mirrored pair of `orders` rows sharing a
 * `tradeOrderId`; the supplier's copy is what they confirm. No stock moves yet
 * — confirmation does that.
 */
export async function placePartnerOrder(input: PlacePartnerOrderInput): Promise<PartnerOrderPair> {
  const link = await loadActiveLink(input.relationshipId, input.buyerOrgId)
  requireCapability(link, 'orders')
  const supplierOrgId = cleanString(link.targetOrgId)

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('An order needs at least one line')
  }

  const lineItems: DealLineItem[] = []
  let currency: Currency = 'ZAR'
  let taxAmount = 0

  for (const line of input.lines) {
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Every line needs a quantity greater than zero')

    const snap = await adminDb.collection(CATALOG_COLLECTION).doc(cleanString(line.catalogItemId)).get()
    if (!snap.exists) throw new Error('Catalogue item not found')
    const item = toItem(snap.id, snap.data() ?? {})
    // The buyer may only order what was published TO them, on THIS link.
    if (item.buyerOrgId !== input.buyerOrgId || item.supplierOrgId !== supplierOrgId) {
      throw new Error('Catalogue item not found')
    }
    if (item.deleted === true || item.active === false) throw new Error(`"${item.name}" is no longer available`)

    const total = item.unitPrice * qty
    currency = item.currency
    taxAmount += total * ((item.taxRate ?? 0) / 100)
    lineItems.push({
      productId: item.productId,
      name: item.name,
      qty,
      unitPrice: item.unitPrice,
      total,
      currency: item.currency,
    })
  }

  const subtotal = lineItems.reduce((sum, l) => sum + l.total, 0)
  const total = subtotal + taxAmount
  const tradeOrderId = crypto.randomUUID()
  const now = Timestamp.now()

  const buyerCompany = await companyRepresenting(input.buyerOrgId, supplierOrgId)
  const supplierCompany = await companyRepresenting(supplierOrgId, input.buyerOrgId)

  const shared = {
    tradeOrderId,
    partnerLinkId: link.partnerLinkId,
    relationshipId: input.relationshipId,
    partnerOrderStatus: 'pending' as PartnerOrderStatus,
    lineItems,
    subtotal,
    taxAmount,
    total,
    currency,
    notes: cleanString(input.notes) || '',
    status: 'draft' as const,
    fulfillmentStatus: 'not_started' as const,
    createdByRef: input.actor,
    updatedByRef: input.actor,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }

  const buyerRef = adminDb.collection(ORDERS_COLLECTION).doc()
  const supplierRef = adminDb.collection(ORDERS_COLLECTION).doc()

  await buyerRef.set(stripUndefined({
    ...shared,
    orgId: input.buyerOrgId,
    counterpartyOrgId: supplierOrgId,
    direction: 'purchase' as PartnerOrderDirection,
    companyId: buyerCompany ?? undefined,
    title: `Purchase order to ${await orgName(supplierOrgId)}`,
    counterpartOrderId: supplierRef.id,
  }))

  await supplierRef.set(stripUndefined({
    ...shared,
    orgId: supplierOrgId,
    counterpartyOrgId: input.buyerOrgId,
    direction: 'sales' as PartnerOrderDirection,
    companyId: supplierCompany ?? undefined,
    title: `Order from ${await orgName(input.buyerOrgId)}`,
    counterpartOrderId: buyerRef.id,
  }))

  const notification = {
    type: 'partner_order.placed',
    title: 'New partner order',
    body: `${await orgName(input.buyerOrgId)} placed an order for ${currency} ${total.toFixed(2)}.`,
    targetOrgIds: [supplierOrgId],
  }
  await recordCrmAuditEvent({
    orgId: supplierOrgId,
    eventType: 'partner_order.placed',
    resourceType: 'order',
    resourceId: supplierRef.id,
    relationshipId: input.relationshipId,
    actorRef: input.actor,
    metadata: { tradeOrderId, buyerOrgId: input.buyerOrgId, total },
    notification,
  })

  return { tradeOrderId, buyerOrderId: buyerRef.id, supplierOrderId: supplierRef.id, total, currency }
}

async function orgName(orgId: string): Promise<string> {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  return cleanString((snap.data() ?? {}).name) || orgId
}

/** The company row in `ownerOrgId`'s CRM that represents `partnerOrgId`. */
async function companyRepresenting(ownerOrgId: string, partnerOrgId: string): Promise<string | null> {
  const snap = await adminDb
    .collection('companies')
    .where('orgId', '==', ownerOrgId)
    .limit(1000)
    .get()
  const hit = snap.docs.find((d) => cleanString((d.data() ?? {}).linkedOrgId) === partnerOrgId)
  return hit?.id ?? null
}

export interface ConfirmPartnerOrderResult {
  tradeOrderId: string
  status: PartnerOrderStatus
  reservedInventoryIds: string[]
  invoiceId?: string
  invoiceNumber?: string
}

/**
 * Supplier confirms (or rejects). On confirm: reserve stock via
 * InventoryMovement rows, flip both order copies, and draft an invoice in the
 * supplier's workspace.
 */
export async function decidePartnerOrder(input: {
  supplierOrgId: string
  orderId: string
  decision: 'confirm' | 'reject'
  actor: MemberRef
}): Promise<ConfirmPartnerOrderResult> {
  const ref = adminDb.collection(ORDERS_COLLECTION).doc(input.orderId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Order not found')
  const order = snap.data() ?? {}
  if (order.orgId !== input.supplierOrgId) throw new Error('Order not found')
  if (order.direction !== 'sales') throw new Error('Only the supplier side of an order can be decided')
  if (order.partnerOrderStatus !== 'pending') {
    throw new Error(`This order is already ${order.partnerOrderStatus}`)
  }

  const tradeOrderId = cleanString(order.tradeOrderId)
  const buyerOrgId = cleanString(order.counterpartyOrgId)
  const now = Timestamp.now()
  const nextStatus: PartnerOrderStatus = input.decision === 'confirm' ? 'confirmed' : 'rejected'

  const patch = {
    partnerOrderStatus: nextStatus,
    status: input.decision === 'confirm' ? 'confirmed' : 'cancelled',
    decidedAt: now,
    updatedByRef: input.actor,
    updatedAt: now,
  }

  // Flip both copies so neither side can drift.
  const pairSnap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('tradeOrderId', '==', tradeOrderId)
    .limit(10)
    .get()
  for (const doc of pairSnap.docs) await doc.ref.set(patch, { merge: true })

  const reservedInventoryIds: string[] = []
  let invoiceId: string | undefined
  let invoiceNumber: string | undefined

  if (input.decision === 'confirm') {
    const lineItems = Array.isArray(order.lineItems) ? order.lineItems as DealLineItem[] : []

    // Reserve stock: move quantityAvailable → quantityReserved, and log the
    // movement so the existing commerce trail stays coherent.
    const invSnap = await adminDb
      .collection('inventoryItems')
      .where('orgId', '==', input.supplierOrgId)
      .limit(1000)
      .get()

    for (const line of lineItems) {
      if (!line.productId) continue
      const invDoc = invSnap.docs.find((d) => {
        const data = d.data() ?? {}
        return data.deleted !== true && cleanString(data.productId) === line.productId
      })
      if (!invDoc) continue
      const data = invDoc.data() ?? {}
      const available = Number(data.quantityAvailable) || 0
      const reserved = Number(data.quantityReserved) || 0
      const take = Math.min(available, line.qty)
      await invDoc.ref.set({
        quantityAvailable: available - take,
        quantityReserved: reserved + take,
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
      reservedInventoryIds.push(invDoc.id)

      await adminDb.collection('inventoryMovements').add(stripUndefined({
        orgId: input.supplierOrgId,
        inventoryItemId: invDoc.id,
        productId: line.productId,
        orderId: input.orderId,
        movementType: 'reserved',
        quantity: take,
        createdByRef: input.actor,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }))
    }

    const drafted = await draftInvoiceForOrder({
      supplierOrgId: input.supplierOrgId,
      buyerOrgId,
      orderId: input.orderId,
      order,
      actor: input.actor,
    })
    invoiceId = drafted?.id
    invoiceNumber = drafted?.invoiceNumber

    if (invoiceId) {
      for (const doc of pairSnap.docs) {
        await doc.ref.set({ invoiceId, updatedAt: now }, { merge: true })
      }

      // The buyer is a party to this invoice, so grant them sight of it
      // directly rather than making it depend on the generic 'invoices'
      // capability. Non-fatal: a share failure must not undo the order.
      await grantSystemShare({
        relationshipId: cleanString(order.relationshipId),
        partnerLinkId: cleanString(order.partnerLinkId),
        ownerOrgId: input.supplierOrgId,
        partnerOrgId: buyerOrgId,
        resourceType: 'invoice',
        resourceId: invoiceId,
        resourceTitle: invoiceNumber,
        actor: input.actor,
      }).catch((err) => console.error('[partner-order-invoice-share-error]', err))
    }
  }

  await recordCrmAuditEvent({
    orgId: input.supplierOrgId,
    eventType: `partner_order.${nextStatus}`,
    resourceType: 'order',
    resourceId: input.orderId,
    relationshipId: cleanString(order.relationshipId),
    actorRef: input.actor,
    metadata: { tradeOrderId, buyerOrgId, invoiceId },
    notification: {
      type: `partner_order.${nextStatus}`,
      title: nextStatus === 'confirmed' ? 'Your order was confirmed' : 'Your order was declined',
      body: nextStatus === 'confirmed'
        ? `${await orgName(input.supplierOrgId)} confirmed your order.`
        : `${await orgName(input.supplierOrgId)} declined your order.`,
      targetOrgIds: [buyerOrgId],
    },
  })

  return { tradeOrderId, status: nextStatus, reservedInventoryIds, invoiceId, invoiceNumber }
}

async function draftInvoiceForOrder(input: {
  supplierOrgId: string
  buyerOrgId: string
  orderId: string
  order: Record<string, unknown>
  actor: MemberRef
}): Promise<{ id: string; invoiceNumber: string } | null> {
  try {
    const buyerName = await orgName(input.buyerOrgId)
    const invoiceNumber = await generateInvoiceNumber(input.supplierOrgId, buyerName)
    const lines = Array.isArray(input.order.lineItems) ? input.order.lineItems as DealLineItem[] : []
    const lineItems = lines.map((l) => ({
      description: l.name,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      amount: l.total,
    }))
    const subtotal = lineItems.reduce((s, l) => s + l.amount, 0)
    const taxAmount = Number(input.order.taxAmount) || 0
    const now = FieldValue.serverTimestamp()

    const ref = await adminDb.collection('invoices').add(stripUndefined({
      orgId: input.supplierOrgId,
      sourceOrgId: input.supplierOrgId,
      issuerOrgId: input.supplierOrgId,
      recipientOrgId: input.buyerOrgId,
      invoiceNumber,
      status: 'draft',
      issueDate: now,
      dueDate: null,
      lineItems,
      subtotal,
      taxRate: subtotal > 0 ? Number(((taxAmount / subtotal) * 100).toFixed(4)) : 0,
      taxAmount,
      total: subtotal + taxAmount,
      currency: cleanString(input.order.currency) || 'ZAR',
      notes: `Auto-drafted from partner order ${input.orderId}.`,
      recipientCompanyName: buyerName,
      orderId: input.orderId,
      tradeOrderId: cleanString(input.order.tradeOrderId),
      paidAt: null,
      sentAt: null,
      createdByRef: input.actor,
      updatedByRef: input.actor,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    }))
    return { id: ref.id, invoiceNumber }
  } catch (err) {
    // An invoice failure must not undo a confirmed order.
    console.error('[partner-order-invoice-error]', err)
    return null
  }
}

// ── Fulfilment ───────────────────────────────────────────────────────────────

export type FulfilAction = 'pack' | 'ship' | 'deliver'

export interface FulfilResult {
  tradeOrderId: string
  fulfillmentStatus: string
  shipmentIds: string[]
}

/**
 * Supplier-side fulfilment: pack → ship → deliver.
 *
 * `ship` is the step that actually consumes stock — reserved quantity leaves
 * the building, so it decrements `quantityReserved` and logs a `shipped`
 * movement. Shipments are mirrored to the buyer (two `shipments` rows sharing
 * the `tradeOrderId`) so both sides can track without a cross-org read.
 */
export async function fulfilPartnerOrder(input: {
  supplierOrgId: string
  orderId: string
  action: FulfilAction
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
  actor: MemberRef
}): Promise<FulfilResult> {
  const ref = adminDb.collection(ORDERS_COLLECTION).doc(input.orderId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Order not found')
  const order = snap.data() ?? {}
  if (order.orgId !== input.supplierOrgId) throw new Error('Order not found')
  if (order.direction !== 'sales') throw new Error('Only the supplier can fulfil an order')
  if (order.partnerOrderStatus !== 'confirmed') {
    throw new Error('Only a confirmed order can be fulfilled')
  }

  const current = cleanString(order.fulfillmentStatus) || 'not_started'
  const ALLOWED: Record<FulfilAction, string[]> = {
    pack: ['not_started', 'picking'],
    ship: ['not_started', 'picking', 'packed'],
    deliver: ['in_transit'],
  }
  if (!ALLOWED[input.action].includes(current)) {
    throw new Error(`Cannot ${input.action} an order that is "${current}"`)
  }

  const tradeOrderId = cleanString(order.tradeOrderId)
  const buyerOrgId = cleanString(order.counterpartyOrgId)
  const now = Timestamp.now()
  const nextStatus = input.action === 'pack' ? 'packed' : input.action === 'ship' ? 'in_transit' : 'delivered'

  const pairSnap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('tradeOrderId', '==', tradeOrderId)
    .limit(10)
    .get()

  const shipmentIds: string[] = []

  if (input.action === 'ship') {
    // Reserved stock now physically leaves; clear the reservation.
    const lineItems = Array.isArray(order.lineItems) ? order.lineItems as DealLineItem[] : []
    const invSnap = await adminDb
      .collection('inventoryItems')
      .where('orgId', '==', input.supplierOrgId)
      .limit(1000)
      .get()

    for (const line of lineItems) {
      if (!line.productId) continue
      const invDoc = invSnap.docs.find((d) => {
        const data = d.data() ?? {}
        return data.deleted !== true && cleanString(data.productId) === line.productId
      })
      if (!invDoc) continue
      const data = invDoc.data() ?? {}
      const reserved = Number(data.quantityReserved) || 0
      const take = Math.min(reserved, line.qty)
      await invDoc.ref.set({
        quantityReserved: reserved - take,
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })

      await adminDb.collection('inventoryMovements').add(stripUndefined({
        orgId: input.supplierOrgId,
        inventoryItemId: invDoc.id,
        productId: line.productId,
        orderId: input.orderId,
        movementType: 'shipped',
        quantity: take,
        createdByRef: input.actor,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }))
    }

    // Mirrored shipment rows so each side tracks from its own tenant.
    for (const doc of pairSnap.docs) {
      const row = doc.data() ?? {}
      const shipRef = adminDb.collection('shipments').doc()
      await shipRef.set(stripUndefined({
        orgId: cleanString(row.orgId),
        companyId: cleanString(row.companyId) || undefined,
        orderId: doc.id,
        tradeOrderId,
        partnerLinkId: cleanString(row.partnerLinkId) || undefined,
        counterpartyOrgId: cleanString(row.counterpartyOrgId) || undefined,
        status: 'in_transit',
        carrier: cleanString(input.carrier) || undefined,
        trackingNumber: cleanString(input.trackingNumber) || undefined,
        trackingUrl: cleanString(input.trackingUrl) || undefined,
        createdByRef: input.actor,
        updatedByRef: input.actor,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }))
      shipmentIds.push(shipRef.id)
    }
  }

  if (input.action === 'deliver') {
    const shipSnap = await adminDb
      .collection('shipments')
      .where('tradeOrderId', '==', tradeOrderId)
      .limit(20)
      .get()
    for (const doc of shipSnap.docs) {
      await doc.ref.set({ status: 'delivered', deliveredAt: now, updatedAt: now }, { merge: true })
      shipmentIds.push(doc.id)
    }
  }

  const patch = stripUndefined({
    fulfillmentStatus: nextStatus,
    status: input.action === 'deliver' ? 'fulfilled' : 'in_progress',
    deliveredAt: input.action === 'deliver' ? now : undefined,
    updatedByRef: input.actor,
    updatedAt: now,
  })
  for (const doc of pairSnap.docs) await doc.ref.set(patch, { merge: true })

  await recordCrmAuditEvent({
    orgId: input.supplierOrgId,
    eventType: `partner_order.${input.action}`,
    resourceType: 'order',
    resourceId: input.orderId,
    relationshipId: cleanString(order.relationshipId),
    actorRef: input.actor,
    metadata: { tradeOrderId, fulfillmentStatus: nextStatus, shipmentIds },
    notification: {
      type: `partner_order.${nextStatus}`,
      title: input.action === 'ship' ? 'Your order has shipped' : input.action === 'deliver' ? 'Your order was delivered' : 'Your order is packed',
      body: input.trackingNumber
        ? `Tracking ${input.trackingNumber}${input.carrier ? ` via ${input.carrier}` : ''}.`
        : `Order is now ${nextStatus.replace('_', ' ')}.`,
      targetOrgIds: [buyerOrgId],
    },
  })

  return { tradeOrderId, fulfillmentStatus: nextStatus, shipmentIds }
}

/**
 * Cancel a partner order. Either side may cancel while it is still pending.
 * After confirmation only the supplier may cancel, and only before shipping —
 * cancelling then releases the reservation back to available stock.
 */
export async function cancelPartnerOrder(input: {
  orgId: string
  orderId: string
  actor: MemberRef
}): Promise<{ tradeOrderId: string; releasedInventoryIds: string[] }> {
  const ref = adminDb.collection(ORDERS_COLLECTION).doc(input.orderId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Order not found')
  const order = snap.data() ?? {}
  if (order.orgId !== input.orgId) throw new Error('Order not found')

  const status = cleanString(order.partnerOrderStatus)
  const fulfilment = cleanString(order.fulfillmentStatus) || 'not_started'
  const isSupplier = order.direction === 'sales'

  if (status === 'cancelled' || status === 'rejected') throw new Error('This order is already closed')
  if (status === 'confirmed') {
    if (!isSupplier) throw new Error('Only the supplier can cancel a confirmed order — ask them to cancel it')
    if (fulfilment !== 'not_started' && fulfilment !== 'picking' && fulfilment !== 'packed') {
      throw new Error('This order has already shipped and cannot be cancelled')
    }
  }

  const tradeOrderId = cleanString(order.tradeOrderId)
  const now = Timestamp.now()
  const releasedInventoryIds: string[] = []

  // Give reserved stock back when a confirmed order is cancelled pre-shipment.
  if (status === 'confirmed') {
    const supplierOrgId = isSupplier ? input.orgId : cleanString(order.counterpartyOrgId)
    const lineItems = Array.isArray(order.lineItems) ? order.lineItems as DealLineItem[] : []
    const invSnap = await adminDb
      .collection('inventoryItems')
      .where('orgId', '==', supplierOrgId)
      .limit(1000)
      .get()

    for (const line of lineItems) {
      if (!line.productId) continue
      const invDoc = invSnap.docs.find((d) => {
        const data = d.data() ?? {}
        return data.deleted !== true && cleanString(data.productId) === line.productId
      })
      if (!invDoc) continue
      const data = invDoc.data() ?? {}
      const reserved = Number(data.quantityReserved) || 0
      const available = Number(data.quantityAvailable) || 0
      const give = Math.min(reserved, line.qty)
      await invDoc.ref.set({
        quantityReserved: reserved - give,
        quantityAvailable: available + give,
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
      releasedInventoryIds.push(invDoc.id)

      await adminDb.collection('inventoryMovements').add(stripUndefined({
        orgId: supplierOrgId,
        inventoryItemId: invDoc.id,
        productId: line.productId,
        orderId: input.orderId,
        movementType: 'released',
        quantity: give,
        createdByRef: input.actor,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }))
    }
  }

  const pairSnap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('tradeOrderId', '==', tradeOrderId)
    .limit(10)
    .get()
  for (const doc of pairSnap.docs) {
    await doc.ref.set({
      partnerOrderStatus: 'cancelled',
      status: 'cancelled',
      cancelledAt: now,
      updatedByRef: input.actor,
      updatedAt: now,
    }, { merge: true })
  }

  const otherOrgId = cleanString(order.counterpartyOrgId)
  await recordCrmAuditEvent({
    orgId: input.orgId,
    eventType: 'partner_order.cancelled',
    resourceType: 'order',
    resourceId: input.orderId,
    relationshipId: cleanString(order.relationshipId),
    actorRef: input.actor,
    metadata: { tradeOrderId, releasedInventoryIds },
    notification: {
      type: 'partner_order.cancelled',
      title: 'Partner order cancelled',
      body: `${await orgName(input.orgId)} cancelled an order.`,
      targetOrgIds: [otherOrgId],
    },
  })

  return { tradeOrderId, releasedInventoryIds }
}

/** Shipments for one side of a trade, for tracking display. */
export async function listPartnerShipments(orgId: string): Promise<Array<Record<string, unknown>>> {
  const snap = await adminDb
    .collection('shipments')
    .where('orgId', '==', orgId)
    .limit(1000)
    .get()
  const rows: Array<Record<string, unknown>> = snap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }))
  return rows.filter((s) => s.deleted !== true && cleanString(s.tradeOrderId))
}

/** Partner orders visible to one org, either side. */
export async function listPartnerOrders(input: {
  orgId: string
  direction?: PartnerOrderDirection
  status?: PartnerOrderStatus
}): Promise<Array<Record<string, unknown>>> {
  const snap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('orgId', '==', input.orgId)
    .limit(1000)
    .get()

  const rows: Array<Record<string, unknown>> = snap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }))
  const seconds = (value: unknown): number =>
    (value as { seconds?: number } | undefined)?.seconds ?? 0

  return rows
    .filter((o) => o.deleted !== true && cleanString(o.tradeOrderId))
    .filter((o) => (input.direction ? o.direction === input.direction : true))
    .filter((o) => (input.status ? o.partnerOrderStatus === input.status : true))
    .sort((a, b) => seconds(b.createdAt) - seconds(a.createdAt))
}
