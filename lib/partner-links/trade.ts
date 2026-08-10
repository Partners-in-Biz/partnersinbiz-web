import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import { generateInvoiceNumber } from '@/lib/invoices/invoice-number'
import type { BusinessRelationship, SharedBusinessCapability } from '@/lib/business-relationships/types'
import type { Currency, DealLineItem } from '@/lib/crm/types'
import { financialTermsHash } from './settlement-contract'
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
 *
 * CONCURRENCY: every state-changing operation runs inside a Firestore
 * transaction so the status precondition, the paired order update, and the
 * inventory reads/writes commit atomically. A retried or concurrent request
 * re-reads the committed state and fails the precondition instead of
 * double-reserving or drifting the mirrored copy. Side effects that are not
 * part of the durable transition (invoice draft, notifications, audit rows,
 * system shares) run AFTER the transaction commits.
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
  /** Request trace key persisted on both order copies. */
  idempotencyKey?: string
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

  // Canonicalise lines before persistence: aggregate duplicate catalogue items
  // by product so each productId appears exactly once. shippedQuantities is
  // keyed by productId, so a duplicate product line would collide in the
  // shipment map and double-reserve against the same stock snapshot.
  const lineItems: DealLineItem[] = []
  const byProduct = new Map<string, { item: PartnerCatalogItem; qty: number }>()

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

    const existing = byProduct.get(item.productId)
    if (existing) existing.qty += qty
    else byProduct.set(item.productId, { item, qty })
  }

  let currency: Currency = 'ZAR'
  let taxAmount = 0

  for (const { item, qty } of byProduct.values()) {
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

  // Make the financial terms immutable and identical on both mirrored orders.
  // Settlement later binds the invoice to this digest; mutable convenience
  // fields (titles, timestamps, workflow state) deliberately do not participate.
  lineItems.sort((a, b) => `${a.productId ?? ''}:${a.name}`.localeCompare(`${b.productId ?? ''}:${b.name}`))
  const subtotal = lineItems.reduce((sum, l) => sum + l.total, 0)
  const total = subtotal + taxAmount
  const taxRate = subtotal > 0 ? Number(((taxAmount / subtotal) * 100).toFixed(4)) : 0
  const financialHash = financialTermsHash({ lineItems, subtotal, taxRate, taxAmount, total, currency })
  const tradeOrderId = crypto.randomUUID()
  const termsHash = crypto.createHash('sha256').update(JSON.stringify({
    tradeOrderId,
    partnerLinkId: cleanString(link.partnerLinkId),
    supplierOrgId,
    buyerOrgId: input.buyerOrgId,
    lineItems: lineItems.map(({ productId, qty, unitPrice, total: lineTotal, currency: lineCurrency }) =>
      ({ productId, qty, unitPrice, total: lineTotal, currency: lineCurrency })),
    subtotal,
    taxAmount,
    total,
    currency,
    notes: cleanString(input.notes) || '',
  })).digest('hex')
  const now = Timestamp.now()

  const buyerCompany = await companyRepresenting(input.buyerOrgId, supplierOrgId)
  const supplierCompany = await companyRepresenting(supplierOrgId, input.buyerOrgId)

  const shared = {
    tradeOrderId,
    termsHash,
    tradeFinancialHash: financialHash,
    partnerLinkId: link.partnerLinkId,
    relationshipId: input.relationshipId,
    partnerOrderStatus: 'pending' as PartnerOrderStatus,
    lineItems,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency,
    notes: cleanString(input.notes) || '',
    idempotencyKey: cleanString(input.idempotencyKey) || undefined,
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

/**
 * A product can span several inventory rows (multiple locations/batches), so
 * stock movements must drain across ALL matching rows rather than assuming one.
 * Reserving 10 against rows of 4 and 8 takes 4 then 6, not 4 and a silent short.
 *
 * Transaction variant: takes a Firestore transaction so the reads that back
 * the arithmetic and the writes that apply it are the SAME snapshot — the
 * stale-snapshot double-count dies here, not in the caller. Returns the rows
 * actually touched and how much each moved, so callers can log one
 * `inventoryMovements` entry per row.
 */
function matchingInventoryRows(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  productId: string,
): FirebaseFirestore.QueryDocumentSnapshot[] {
  return docs.filter((d) => {
    const data = d.data() ?? {}
    return data.deleted !== true && cleanString(data.productId) === productId
  })
}

type StockMode = 'reserve' | 'ship' | 'release'

async function applyStockMovementTx(input: {
  tx: FirebaseFirestore.Transaction
  rows: FirebaseFirestore.QueryDocumentSnapshot[]
  quantity: number
  mode: StockMode
  actor: MemberRef
  now: Timestamp
}): Promise<Array<{ id: string; moved: number }>> {
  // Fail closed before staging any writes. A confirmed order means every line is
  // reserved in full; partial reservation would create an unfulfillable contract.
  const capacity = input.rows.reduce((sum, doc) => {
    const data = doc.data() ?? {}
    return sum + Math.max(0, Number(input.mode === 'reserve' ? data.quantityAvailable : data.quantityReserved) || 0)
  }, 0)
  if (capacity < input.quantity) {
    throw new Error(`Insufficient reserved stock: need ${input.quantity}, only ${capacity} is available`)
  }

  let remaining = input.quantity
  const touched: Array<{ id: string; moved: number }> = []

  for (const doc of input.rows) {
    if (remaining <= 0) break
    const data = doc.data() ?? {}
    const available = Number(data.quantityAvailable) || 0
    const reserved = Number(data.quantityReserved) || 0

    // reserve draws from available; ship and release draw from reserved.
    const capacity = input.mode === 'reserve' ? available : reserved
    const moved = Math.min(capacity, remaining)
    if (moved <= 0) continue

    const patch: Record<string, unknown> = { updatedByRef: input.actor, updatedAt: input.now }
    if (input.mode === 'reserve') {
      patch.quantityAvailable = available - moved
      patch.quantityReserved = reserved + moved
    } else if (input.mode === 'ship') {
      patch.quantityReserved = reserved - moved
    } else {
      patch.quantityReserved = reserved - moved
      patch.quantityAvailable = available + moved
    }

    input.tx.set(doc.ref, patch, { merge: true })
    touched.push({ id: doc.id, moved })
    remaining -= moved
  }

  return touched
}

/**
 * Inside a transaction: prove the partner link is STILL live between these two
 * orgs. Both mirrored relationship rows must exist, be active, not deleted,
 * and together name exactly the two orgs on this order. Every state-changing
 * trade/settlement mutation calls this at mutation time, so a supplier cannot
 * confirm, fulfil or settle an order after either side has unlinked.
 */
async function assertLivePartnerLinkTx(input: {
  tx: FirebaseFirestore.Transaction
  partnerLinkId: string
  orgA: string
  orgB: string
}): Promise<void> {
  const partnerLinkId = cleanString(input.partnerLinkId)
  if (!partnerLinkId) throw new Error('This order is not linked to an active partner link')
  const snap = await input.tx.get(
    adminDb
      .collection('businessRelationships')
      .where('partnerLinkId', '==', partnerLinkId)
      .limit(10),
  )
  const rows = snap.docs.map((d) => d.data() ?? {})
  const activeOrgIds = new Set(
    rows
      .filter((r) => r.status === 'active' && r.deleted !== true)
      .map((r) => cleanString(r.sourceOrgId)),
  )
  if (activeOrgIds.size < 2 || !activeOrgIds.has(input.orgA) || !activeOrgIds.has(input.orgB)) {
    throw new Error('This partner link is no longer active')
  }
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
 *
 * The durable transition — status preconditions, the mirrored pair flip, the
 * inventory reserve and the movement rows — commits in ONE Firestore
 * transaction. Concurrent double-confirms or a confirm racing a cancel
 * re-read the committed state inside the transaction and fail the
 * "already X" precondition instead of double-reserving. Invoice drafting, the
 * invoiceId stamp, system share and notifications are side effects that run
 * AFTER the committed transition (the invoice counter is itself a
 * transaction, so it can never nest inside this one).
 */
export async function decidePartnerOrder(input: {
  supplierOrgId: string
  orderId: string
  decision: 'confirm' | 'reject'
  actor: MemberRef
}): Promise<ConfirmPartnerOrderResult> {
  const ref = adminDb.collection(ORDERS_COLLECTION).doc(input.orderId)
  const now = Timestamp.now()
  const nextStatus: PartnerOrderStatus = input.decision === 'confirm' ? 'confirmed' : 'rejected'

  const patch = {
    partnerOrderStatus: nextStatus,
    status: input.decision === 'confirm' ? 'confirmed' : 'cancelled',
    decidedAt: now,
    updatedByRef: input.actor,
    updatedAt: now,
  }

  const txOutcome = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('Order not found')
    const order = snap.data() ?? {}
    if (order.orgId !== input.supplierOrgId) throw new Error('Order not found')
    if (order.direction !== 'sales') throw new Error('Only the supplier side of an order can be decided')
    if (order.partnerOrderStatus !== 'pending') {
      throw new Error(`This order is already ${order.partnerOrderStatus}`)
    }

    const tradeOrderId = cleanString(order.tradeOrderId)
    const buyerOrgId = cleanString(order.counterpartyOrgId)

    // The link must still be live at mutation time — unlink closes the trade.
    await assertLivePartnerLinkTx({
      tx,
      partnerLinkId: cleanString(order.partnerLinkId),
      orgA: input.supplierOrgId,
      orgB: buyerOrgId,
    })

    // All reads before any write: the mirrored pair plus (for confirm) stock.
    const pairSnap = await tx.get(
      adminDb
        .collection(ORDERS_COLLECTION)
        .where('tradeOrderId', '==', tradeOrderId)
        .limit(10),
    )

    const reservedInventoryIds: string[] = []

    if (input.decision === 'confirm') {
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems as DealLineItem[] : []
      const invSnap = await tx.get(
        adminDb
          .collection('inventoryItems')
          .where('orgId', '==', input.supplierOrgId)
          .limit(1000),
      )

      for (const line of lineItems) {
        if (!line.productId) continue
        const touched = await applyStockMovementTx({
          tx,
          rows: matchingInventoryRows(invSnap.docs, line.productId),
          quantity: line.qty,
          mode: 'reserve',
          actor: input.actor,
          now,
        })
        for (const row of touched) {
          reservedInventoryIds.push(row.id)
          tx.set(adminDb.collection('inventoryMovements').doc(), stripUndefined({
            orgId: input.supplierOrgId,
            inventoryItemId: row.id,
            productId: line.productId,
            orderId: input.orderId,
            movementType: 'reserved',
            quantity: row.moved,
            createdByRef: input.actor,
            createdAt: now,
            updatedAt: now,
            deleted: false,
          }))
        }
      }
    }

    // Flip both copies so neither side can drift.
    for (const doc of pairSnap.docs) tx.set(doc.ref, patch, { merge: true })

    return { order, tradeOrderId, buyerOrgId, counterpartOrderId: cleanString(order.counterpartOrderId), reservedInventoryIds }
  })

  const reservedInventoryIds = txOutcome.reservedInventoryIds
  let invoiceId: string | undefined
  let invoiceNumber: string | undefined

  if (input.decision === 'confirm') {
    // Side effect AFTER the committed transition — the invoice counter runs
    // its own transaction and cannot nest inside ours.
    const drafted = await draftInvoiceForOrder({
      supplierOrgId: input.supplierOrgId,
      buyerOrgId: txOutcome.buyerOrgId,
      orderId: input.orderId,
      order: txOutcome.order,
      actor: input.actor,
    })
    invoiceId = drafted?.id
    invoiceNumber = drafted?.invoiceNumber

    if (invoiceId) {
      const stamp = { invoiceId, updatedAt: now }
      await ref.set(stamp, { merge: true })
      if (txOutcome.counterpartOrderId) {
        await adminDb.collection(ORDERS_COLLECTION).doc(txOutcome.counterpartOrderId).set(stamp, { merge: true })
      }

      // The buyer is a party to this invoice, so grant them sight of it
      // directly rather than making it depend on the generic 'invoices'
      // capability. Non-fatal: a share failure must not undo the order.
      await grantSystemShare({
        relationshipId: cleanString(txOutcome.order.relationshipId),
        partnerLinkId: cleanString(txOutcome.order.partnerLinkId),
        ownerOrgId: input.supplierOrgId,
        partnerOrgId: txOutcome.buyerOrgId,
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
    relationshipId: cleanString(txOutcome.order.relationshipId),
    actorRef: input.actor,
    metadata: { tradeOrderId: txOutcome.tradeOrderId, buyerOrgId: txOutcome.buyerOrgId, invoiceId },
    notification: {
      type: `partner_order.${nextStatus}`,
      title: nextStatus === 'confirmed' ? 'Your order was confirmed' : 'Your order was declined',
      body: nextStatus === 'confirmed'
        ? `${await orgName(input.supplierOrgId)} confirmed your order.`
        : `${await orgName(input.supplierOrgId)} declined your order.`,
      targetOrgIds: [txOutcome.buyerOrgId],
    },
  })

  return { tradeOrderId: txOutcome.tradeOrderId, status: nextStatus, reservedInventoryIds, invoiceId, invoiceNumber }
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
      productId: l.productId,
      description: l.name,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      amount: l.total,
    }))
    const subtotal = lineItems.reduce((s, l) => s + l.amount, 0)
    const taxAmount = Number(input.order.taxAmount) || 0
    const taxRate = subtotal > 0 ? Number(((taxAmount / subtotal) * 100).toFixed(4)) : 0
    const total = subtotal + taxAmount
    const tradeFinancialHash = financialTermsHash({
      lineItems, subtotal, taxRate, taxAmount, total, currency: cleanString(input.order.currency) || 'ZAR',
    })
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
      taxRate,
      taxAmount,
      total,
      currency: cleanString(input.order.currency) || 'ZAR',
      notes: `Auto-drafted from partner order ${input.orderId}.`,
      recipientCompanyName: buyerName,
      // Immutable settlement binding. The finance flow refuses legacy invoices
      // that lack any part of this pair rather than inferring from CRM pointers.
      partnerLinkId: cleanString(input.order.partnerLinkId),
      supplierOrderId: input.orderId,
      buyerOrderId: cleanString(input.order.counterpartOrderId),
      tradeTermsHash: cleanString(input.order.termsHash),
      tradeFinancialHash,
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
 *
 * The whole transition (status preconditions, mirrored pair update, stock
 * decrement, movement rows and mirrored shipment rows) commits in ONE Firestore
 * transaction, so concurrent ship/deliver/cancel requests re-read committed
 * state and fail the transition table instead of double-shipping.
 */
export async function fulfilPartnerOrder(input: {
  supplierOrgId: string
  orderId: string
  action: FulfilAction
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
  /**
   * Partial shipment: how much of each product goes out now, keyed by
   * productId. Omit to ship everything still outstanding. Quantities are
   * clamped to what remains, so over-shipping is impossible.
   */
  quantities?: Record<string, number>
  actor: MemberRef
}): Promise<FulfilResult> {
  const ref = adminDb.collection(ORDERS_COLLECTION).doc(input.orderId)
  const now = Timestamp.now()
  const carrier = cleanString(input.carrier) || undefined
  const trackingNumber = cleanString(input.trackingNumber) || undefined
  const trackingUrl = cleanString(input.trackingUrl) || undefined

  const txOutcome = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
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

    // The link must still be live at mutation time — unlink closes the trade.
    await assertLivePartnerLinkTx({
      tx,
      partnerLinkId: cleanString(order.partnerLinkId),
      orgA: input.supplierOrgId,
      orgB: buyerOrgId,
    })

    const pairSnap = await tx.get(
      adminDb
        .collection(ORDERS_COLLECTION)
        .where('tradeOrderId', '==', tradeOrderId)
        .limit(10),
    )

    const shipmentIds: string[] = []
    const shippedLines: DealLineItem[] = []
    let fullyShipped = true

    if (input.action === 'ship') {
      // Reserved stock now physically leaves; clear that much of the reservation.
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems as DealLineItem[] : []
      const alreadyShipped = (order.shippedQuantities ?? {}) as Record<string, number>
      const nextShipped: Record<string, number> = { ...alreadyShipped }

      const invSnap = await tx.get(
        adminDb
          .collection('inventoryItems')
          .where('orgId', '==', input.supplierOrgId)
          .limit(1000),
      )

      for (const line of lineItems) {
        if (!line.productId) continue
        const done = Number(alreadyShipped[line.productId]) || 0
        const outstanding = Math.max(0, line.qty - done)
        if (outstanding === 0) continue

        const requested = input.quantities
          ? Math.max(0, Number(input.quantities[line.productId]) || 0)
          : outstanding
        const shipping = Math.min(requested, outstanding)
        if (shipping === 0) continue

        nextShipped[line.productId] = done + shipping
        shippedLines.push({ ...line, qty: shipping, total: line.unitPrice * shipping })

        const touched = await applyStockMovementTx({
          tx,
          rows: matchingInventoryRows(invSnap.docs, line.productId),
          quantity: shipping,
          mode: 'ship',
          actor: input.actor,
          now,
        })
        for (const row of touched) {
          tx.set(adminDb.collection('inventoryMovements').doc(), stripUndefined({
            orgId: input.supplierOrgId,
            inventoryItemId: row.id,
            productId: line.productId,
            orderId: input.orderId,
            movementType: 'shipped',
            quantity: row.moved,
            createdByRef: input.actor,
            createdAt: now,
            updatedAt: now,
            deleted: false,
          }))
        }
      }

      fullyShipped = lineItems.every((l) =>
        !l.productId || (Number(nextShipped[l.productId]) || 0) >= l.qty)

      for (const doc of pairSnap.docs) {
        tx.set(doc.ref, { shippedQuantities: nextShipped, updatedAt: now }, { merge: true })
      }

      // Mirrored shipment rows so each side tracks from its own tenant.
      for (const doc of pairSnap.docs) {
        const row = doc.data() ?? {}
        const shipRef = adminDb.collection('shipments').doc()
        tx.set(shipRef, stripUndefined({
          orgId: cleanString(row.orgId),
          companyId: cleanString(row.companyId) || undefined,
          orderId: doc.id,
          tradeOrderId,
          partnerLinkId: cleanString(row.partnerLinkId) || undefined,
          counterpartyOrgId: cleanString(row.counterpartyOrgId) || undefined,
          status: 'in_transit',
          carrier,
          trackingNumber,
          trackingUrl,
          lineItems: shippedLines,
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
      const shipSnap = await tx.get(
        adminDb
          .collection('shipments')
          .where('tradeOrderId', '==', tradeOrderId)
          .limit(20),
      )
      for (const doc of shipSnap.docs) {
        tx.set(doc.ref, { status: 'delivered', deliveredAt: now, updatedAt: now }, { merge: true })
        shipmentIds.push(doc.id)
      }
    }

    // A partial shipment stays 'packed' so the remainder can still be shipped;
    // only a complete shipment moves the order to in_transit.
    let nextStatus = input.action === 'pack' ? 'packed' : input.action === 'ship' ? 'in_transit' : 'delivered'
    if (input.action === 'ship' && !fullyShipped) nextStatus = 'packed'

    const patch = stripUndefined({
      fulfillmentStatus: nextStatus,
      status: input.action === 'deliver' ? 'fulfilled' : 'in_progress',
      deliveredAt: input.action === 'deliver' ? now : undefined,
      updatedByRef: input.actor,
      updatedAt: now,
    })
    for (const doc of pairSnap.docs) tx.set(doc.ref, patch, { merge: true })

    return { tradeOrderId, buyerOrgId, relationshipId: cleanString(order.relationshipId), nextStatus, shipmentIds }
  })

  await recordCrmAuditEvent({
    orgId: input.supplierOrgId,
    eventType: `partner_order.${input.action}`,
    resourceType: 'order',
    resourceId: input.orderId,
    relationshipId: txOutcome.relationshipId,
    actorRef: input.actor,
    metadata: { tradeOrderId: txOutcome.tradeOrderId, fulfillmentStatus: txOutcome.nextStatus, shipmentIds: txOutcome.shipmentIds },
    notification: {
      type: `partner_order.${txOutcome.nextStatus}`,
      title: input.action === 'ship' ? 'Your order has shipped' : input.action === 'deliver' ? 'Your order was delivered' : 'Your order is packed',
      body: trackingNumber
        ? `Tracking ${trackingNumber}${carrier ? ` via ${carrier}` : ''}.`
        : `Order is now ${txOutcome.nextStatus.replace('_', ' ')}.`,
      targetOrgIds: [txOutcome.buyerOrgId],
    },
  })

  return { tradeOrderId: txOutcome.tradeOrderId, fulfillmentStatus: txOutcome.nextStatus, shipmentIds: txOutcome.shipmentIds }
}

/**
 * Cancel a partner order. Either side may cancel while it is still pending.
 * After confirmation only the supplier may cancel, and only before shipping —
 * cancelling then releases the reservation back to available stock.
 *
 * The release of reserved stock and the mirrored cancel flip commit in one
 * Firestore transaction, so a cancel racing a confirm or a ship re-reads the
 * committed state and follows the same legal-transition rules.
 */
export async function cancelPartnerOrder(input: {
  orgId: string
  orderId: string
  actor: MemberRef
}): Promise<{ tradeOrderId: string; releasedInventoryIds: string[] }> {
  const ref = adminDb.collection(ORDERS_COLLECTION).doc(input.orderId)
  const now = Timestamp.now()

  const txOutcome = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('Order not found')
    const order = snap.data() ?? {}
    if (order.orgId !== input.orgId) throw new Error('Order not found')

    const status = cleanString(order.partnerOrderStatus)
    const fulfilment = cleanString(order.fulfillmentStatus) || 'not_started'
    const isSupplier = order.direction === 'sales'

    if (status === 'cancelled' || status === 'rejected') throw new Error('This order is already closed')
    const shippedQuantities = (order.shippedQuantities ?? {}) as Record<string, number>
    const hasShippedGoods = Object.values(shippedQuantities).some((qty) => Number(qty) > 0)
    if (hasShippedGoods) {
      throw new Error('This order has shipped goods and requires a credit note; it cannot be cancelled')
    }
    if (status === 'confirmed') {
      if (!isSupplier) throw new Error('Only the supplier can cancel a confirmed order — ask them to cancel it')
      if (fulfilment !== 'not_started' && fulfilment !== 'picking' && fulfilment !== 'packed') {
        throw new Error('This order has already shipped and cannot be cancelled')
      }
    }

    const tradeOrderId = cleanString(order.tradeOrderId)
    const otherOrgId = cleanString(order.counterpartyOrgId)

    // The link must still be live at mutation time — unlink closes the trade.
    await assertLivePartnerLinkTx({
      tx,
      partnerLinkId: cleanString(order.partnerLinkId),
      orgA: input.orgId,
      orgB: otherOrgId,
    })

    const pairSnap = await tx.get(
      adminDb
        .collection(ORDERS_COLLECTION)
        .where('tradeOrderId', '==', tradeOrderId)
        .limit(10),
    )

    const releasedInventoryIds: string[] = []

    // Give reserved stock back when a confirmed order is cancelled pre-shipment.
    if (status === 'confirmed') {
      const supplierOrgId = isSupplier ? input.orgId : cleanString(order.counterpartyOrgId)
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems as DealLineItem[] : []
      const invSnap = await tx.get(
        adminDb
          .collection('inventoryItems')
          .where('orgId', '==', supplierOrgId)
          .limit(1000),
      )

      for (const line of lineItems) {
        if (!line.productId) continue
        const touched = await applyStockMovementTx({
          tx,
          rows: matchingInventoryRows(invSnap.docs, line.productId),
          quantity: line.qty,
          mode: 'release',
          actor: input.actor,
          now,
        })
        for (const row of touched) {
          releasedInventoryIds.push(row.id)
          tx.set(adminDb.collection('inventoryMovements').doc(), stripUndefined({
            orgId: supplierOrgId,
            inventoryItemId: row.id,
            productId: line.productId,
            orderId: input.orderId,
            movementType: 'released',
            quantity: row.moved,
            createdByRef: input.actor,
            createdAt: now,
            updatedAt: now,
            deleted: false,
          }))
        }
      }
    }

    for (const doc of pairSnap.docs) {
      tx.set(doc.ref, {
        partnerOrderStatus: 'cancelled',
        status: 'cancelled',
        cancelledAt: now,
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
    }

    return { tradeOrderId, otherOrgId, relationshipId: cleanString(order.relationshipId), releasedInventoryIds }
  })

  await recordCrmAuditEvent({
    orgId: input.orgId,
    eventType: 'partner_order.cancelled',
    resourceType: 'order',
    resourceId: input.orderId,
    relationshipId: txOutcome.relationshipId,
    actorRef: input.actor,
    metadata: { tradeOrderId: txOutcome.tradeOrderId, releasedInventoryIds: txOutcome.releasedInventoryIds },
    notification: {
      type: 'partner_order.cancelled',
      title: 'Partner order cancelled',
      body: `${await orgName(input.orgId)} cancelled an order.`,
      targetOrgIds: [txOutcome.otherOrgId],
    },
  })

  return { tradeOrderId: txOutcome.tradeOrderId, releasedInventoryIds: txOutcome.releasedInventoryIds }
}

/**
 * Cancel supplier-owned pending or unshipped confirmed orders during unlink.
 * This runs before relationship revocation so the normal transactional liveness
 * and stock-release checks remain in force. Any failure aborts unlink rather
 * than falsely reporting success with reserved inventory stranded.
 */
export async function cancelOpenOrdersForPartnerLink(input: {
  partnerLinkId: string
  actor: MemberRef
}): Promise<{ cancelledOrderIds: string[]; releasedInventoryIds: string[] }> {
  if (!input.partnerLinkId) return { cancelledOrderIds: [], releasedInventoryIds: [] }
  const snap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('partnerLinkId', '==', input.partnerLinkId)
    .limit(1000)
    .get()
  const seenTrades = new Set<string>()
  const cancelledOrderIds: string[] = []
  const releasedInventoryIds: string[] = []

  for (const doc of snap.docs) {
    const order = doc.data() ?? {}
    if (order.deleted === true || order.direction !== 'sales') continue
    const status = cleanString(order.partnerOrderStatus)
    const fulfilment = cleanString(order.fulfillmentStatus) || 'not_started'
    const shippedQuantities = (order.shippedQuantities ?? {}) as Record<string, unknown>
    const hasShippedGoods = Object.values(shippedQuantities).some((quantity) => Number(quantity) > 0)
    if (status !== 'pending' && status !== 'confirmed') continue
    if (hasShippedGoods || !['not_started', 'picking', 'packed'].includes(fulfilment)) continue
    const tradeOrderId = cleanString(order.tradeOrderId)
    if (!tradeOrderId || seenTrades.has(tradeOrderId)) continue
    seenTrades.add(tradeOrderId)

    const result = await cancelPartnerOrder({
      orgId: cleanString(order.orgId),
      orderId: doc.id,
      actor: input.actor,
    })
    cancelledOrderIds.push(doc.id)
    releasedInventoryIds.push(...result.releasedInventoryIds)
  }

  return { cancelledOrderIds, releasedInventoryIds }
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
