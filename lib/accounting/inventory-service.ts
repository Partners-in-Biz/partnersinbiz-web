import { createHash } from 'crypto'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import {
  applyInboundPosition,
  applyOutboundPosition,
  averageUnitCostMinor,
  buildCogsJournalLines,
  FinanceValidationError,
} from './inventory'
import type {
  CogsPosting,
  InventoryAuditEvent,
  InventoryBundle,
  InventoryItem,
  StockAdjustment,
  StockMovement,
  StockOnHandReport,
} from './inventory-types'
import { parseCanonicalDate, requiredText } from './foundation'

export { FinanceValidationError }

export class InventoryFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'InventoryFinanceNotFoundError'
  }
}

export interface InventoryFinanceStore {
  items: Map<string, InventoryItem>
  movements: Map<string, StockMovement>
  adjustments: Map<string, StockAdjustment>
  cogsPostings: Map<string, CogsPosting>
  auditEvents: Map<string, InventoryAuditEvent>
  claims: Set<string>
  idempotency: Map<string, { operation: string; resultId: string }>
  auditHeads: Map<string, string>
}

export function createEmptyInventoryStore(): InventoryFinanceStore {
  return {
    items: new Map(),
    movements: new Map(),
    adjustments: new Map(),
    cogsPostings: new Map(),
    auditEvents: new Map(),
    claims: new Set(),
    idempotency: new Map(),
    auditHeads: new Map(),
  }
}

export function cloneInventoryStore(store: InventoryFinanceStore): InventoryFinanceStore {
  return {
    items: new Map(store.items),
    movements: new Map(store.movements),
    adjustments: new Map(store.adjustments),
    cogsPostings: new Map(store.cogsPostings),
    auditEvents: new Map(store.auditEvents),
    claims: new Set(store.claims),
    idempotency: new Map(store.idempotency),
    auditHeads: new Map(store.auditHeads),
  }
}

export interface CreateInventoryItemCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  sku: string
  name: string
  description?: string
  incomeAccountId: string
  cogsAccountId: string
  inventoryAssetAccountId: string
  trackQuantity: boolean
  currency?: string
  crmInventoryItemId?: string
  /** Optional opening stock when trackQuantity. */
  openingQuantityMilli?: number
  openingUnitCostMinor?: number
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface UpdateInventoryItemCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name?: string
  description?: string
  incomeAccountId?: string
  cogsAccountId?: string
  inventoryAssetAccountId?: string
  trackQuantity?: boolean
  status?: 'active' | 'archived'
  crmInventoryItemId?: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface BillReceiptLineInput {
  itemId?: string
  sku?: string
  quantityMilli: number
  unitCostMinor: number
  sourceLineId?: string
}

export interface ApplyBillReceiptCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  billId: string
  billNumber?: string
  receivedAt: string
  lines: BillReceiptLineInput[]
  requestId: string
  idempotencyKey: string
}

export interface InvoiceIssueLineInput {
  itemId?: string
  sku?: string
  quantityMilli: number
  sourceLineId?: string
}

export interface ApplyInvoiceIssueCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  invoiceId: string
  invoiceNumber?: string
  issuedAt: string
  lines: InvoiceIssueLineInput[]
  requestId: string
  idempotencyKey: string
}

export interface CreateStockAdjustmentCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  itemId: string
  quantityDeltaMilli: number
  unitCostMinor?: number
  reason: string
  adjustedAt: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export type CogsJournalPoster = (input: {
  actor: FinanceActorContext
  posting: CogsPosting
  journalEntryId: string
  requestId: string
  idempotencyKey: string
}) => Promise<{ id: string }>

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function claim(store: InventoryFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new FinanceValidationError(message)
  store.claims.add(key)
}

function requireScope(command: { orgId: string; legalEntityId: string; bookId: string }): Required<FinanceScope> {
  return {
    orgId: requiredText(command.orgId, 'orgId'),
    legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
    bookId: requiredText(command.bookId, 'bookId'),
  }
}

function assertExactScope(record: FinanceScope & { bookId?: string }, scope: Required<FinanceScope>, label: string) {
  if (record.orgId !== scope.orgId || record.legalEntityId !== scope.legalEntityId || record.bookId !== scope.bookId) {
    throw new InventoryFinanceNotFoundError(`${label} not found`)
  }
}

function replayIdempotent<T extends { id: string }>(
  store: InventoryFinanceStore,
  operation: string,
  key: string,
  load: (id: string) => T | undefined,
): T | null {
  const existing = store.idempotency.get(key)
  if (!existing) return null
  if (existing.operation !== operation) {
    throw new FinanceValidationError('Idempotency key already used for a different operation')
  }
  const result = load(existing.resultId)
  if (!result) throw new FinanceValidationError('Idempotent result missing from store')
  return result
}

function rememberIdempotent(store: InventoryFinanceStore, operation: string, key: string, resultId: string) {
  store.idempotency.set(key, { operation, resultId })
}

function hardGates() {
  return {
    sarsSubmissionInitiated: false as const,
    externalPaymentInitiated: false as const,
    externalEgressAllowed: false as const,
  }
}

function appendAudit(
  store: InventoryFinanceStore,
  scope: Required<FinanceScope>,
  actor: FinanceActorContext,
  eventType: string,
  entityType: string,
  entityId: string,
  entityVersion: number,
  at: string,
  requestId: string,
  summary: string,
) {
  const headKey = `${scope.orgId}|${scope.legalEntityId}|${scope.bookId}`
  const previousEventId = store.auditHeads.get(headKey)
  const id = `inv-audit-${digest([headKey, eventType, entityId, entityVersion, at, requestId]).slice(0, 24)}`
  const chainHash = digest([previousEventId || null, eventType, entityType, entityId, entityVersion, actor.uid, at, summary])
  const event: InventoryAuditEvent = {
    id,
    orgId: scope.orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    eventType,
    entityType,
    entityId,
    entityVersion,
    actorId: actor.uid,
    at,
    requestId,
    summary,
    externalEgressAllowed: false,
    ...(previousEventId ? { previousEventId } : {}),
    chainHash,
  }
  store.auditEvents.set(id, event)
  store.auditHeads.set(headKey, id)
  return event
}

function findItemBySku(store: InventoryFinanceStore, scope: Required<FinanceScope>, sku: string): InventoryItem | undefined {
  const normalized = sku.trim().toUpperCase()
  for (const item of store.items.values()) {
    if (
      item.orgId === scope.orgId &&
      item.legalEntityId === scope.legalEntityId &&
      item.bookId === scope.bookId &&
      item.sku.toUpperCase() === normalized
    ) {
      return item
    }
  }
  return undefined
}

function resolveItem(
  store: InventoryFinanceStore,
  scope: Required<FinanceScope>,
  ref: { itemId?: string; sku?: string },
): InventoryItem {
  if (ref.itemId) {
    const item = store.items.get(ref.itemId)
    if (!item) throw new InventoryFinanceNotFoundError('Inventory item not found')
    assertExactScope(item, scope, 'Inventory item')
    return item
  }
  if (ref.sku) {
    const item = findItemBySku(store, scope, ref.sku)
    if (!item) throw new InventoryFinanceNotFoundError('Inventory item not found')
    return item
  }
  throw new FinanceValidationError('itemId or sku is required')
}

function buildStockOnHand(store: InventoryFinanceStore, scope: Required<FinanceScope>, at: string): StockOnHandReport {
  const items = [...store.items.values()]
    .filter((i) => i.orgId === scope.orgId && i.legalEntityId === scope.legalEntityId && i.bookId === scope.bookId)
    .sort((a, b) => a.sku.localeCompare(b.sku))
  const lines = items.map((item) => ({
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    trackQuantity: item.trackQuantity,
    status: item.status,
    quantityOnHandMilli: item.quantityOnHandMilli,
    inventoryValueMinor: item.inventoryValueMinor,
    averageUnitCostMinor: averageUnitCostMinor(item.inventoryValueMinor, item.quantityOnHandMilli),
    incomeAccountId: item.incomeAccountId,
    cogsAccountId: item.cogsAccountId,
    inventoryAssetAccountId: item.inventoryAssetAccountId,
  }))
  const tracked = lines.filter((l) => l.trackQuantity)
  return {
    ...scope,
    asOf: at,
    currency: items[0]?.currency || 'ZAR',
    generatedAt: at,
    itemCount: lines.length,
    trackedItemCount: tracked.length,
    totalQuantityMilli: tracked.reduce((s, l) => s + l.quantityOnHandMilli, 0),
    totalInventoryValueMinor: tracked.reduce((s, l) => s + l.inventoryValueMinor, 0),
    lines,
    externalEgressAllowed: false,
  }
}

export class InventoryFinanceService {
  constructor(
    private readonly load: () => Promise<InventoryFinanceStore>,
    private readonly save: (before: InventoryFinanceStore, after: InventoryFinanceStore) => Promise<void>,
    private readonly postCogsJournal: CogsJournalPoster = async ({ journalEntryId }) => ({ id: journalEntryId }),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createItem(actor: FinanceActorContext, command: CreateInventoryItemCommand): Promise<InventoryItem> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'inventory.item.create', this.now())
    const store = cloneInventoryStore(await this.load())
    const idem = replayIdempotent(store, 'inventory.item.create', command.idempotencyKey, (id) => store.items.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.items.has(id)) throw new FinanceValidationError('Inventory item id already exists')
    const sku = requiredText(command.sku, 'sku').trim().toUpperCase()
    const name = requiredText(command.name, 'name')
    const incomeAccountId = requiredText(command.incomeAccountId, 'incomeAccountId')
    const cogsAccountId = requiredText(command.cogsAccountId, 'cogsAccountId')
    const inventoryAssetAccountId = requiredText(command.inventoryAssetAccountId, 'inventoryAssetAccountId')
    if (cogsAccountId === inventoryAssetAccountId) {
      throw new FinanceValidationError('COGS account must differ from inventory asset account')
    }
    claim(store, `sku:${scope.orgId}:${scope.bookId}:${sku}`, 'SKU already exists in this book')

    const at = this.now()
    let quantityOnHandMilli = 0
    let inventoryValueMinor = 0
    const trackQuantity = Boolean(command.trackQuantity)
    const openingQty = command.openingQuantityMilli ?? 0
    if (openingQty < 0 || !Number.isInteger(openingQty)) {
      throw new FinanceValidationError('openingQuantityMilli must be a non-negative integer')
    }
    if (openingQty > 0) {
      if (!trackQuantity) throw new FinanceValidationError('Opening quantity requires trackQuantity')
      const unit = command.openingUnitCostMinor ?? 0
      if (!Number.isInteger(unit) || unit < 0) throw new FinanceValidationError('openingUnitCostMinor must be a non-negative integer')
      const inbound = applyInboundPosition({ quantityOnHandMilli: 0, inventoryValueMinor: 0 }, openingQty, unit)
      quantityOnHandMilli = inbound.quantityOnHandMilli
      inventoryValueMinor = inbound.inventoryValueMinor
    }

    const item: InventoryItem = {
      id,
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: at,
      createdBy: actor.uid,
      updatedAt: at,
      updatedBy: actor.uid,
      sku,
      name,
      ...(command.description ? { description: command.description } : {}),
      incomeAccountId,
      cogsAccountId,
      inventoryAssetAccountId,
      trackQuantity,
      status: 'active',
      quantityOnHandMilli,
      inventoryValueMinor,
      ...(command.crmInventoryItemId ? { crmInventoryItemId: command.crmInventoryItemId } : {}),
      currency: (command.currency || 'ZAR').toUpperCase(),
      ...hardGates(),
    }
    store.items.set(id, item)

    if (openingQty > 0) {
      const movementId = `mvt-open-${id}`
      const unitCostMinor = command.openingUnitCostMinor ?? 0
      const totalCostMinor = inventoryValueMinor
      const movement: StockMovement = {
        id: movementId,
        orgId: scope.orgId,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        schemaVersion: 1,
        version: 1,
        createdAt: at,
        createdBy: actor.uid,
        updatedAt: at,
        updatedBy: actor.uid,
        itemId: id,
        sku,
        direction: 'in',
        reason: 'opening',
        quantityMilli: openingQty,
        unitCostMinor,
        totalCostMinor,
        quantityAfterMilli: quantityOnHandMilli,
        valueAfterMinor: inventoryValueMinor,
        sourceType: 'opening',
        sourceId: id,
        movementAt: at,
        actorId: actor.uid,
        note: 'Opening stock',
        ...hardGates(),
      }
      store.movements.set(movementId, movement)
    }

    appendAudit(store, scope, actor, 'inventory.item.created', 'inventory_item', id, 1, at, command.requestId, `Created SKU ${sku}`)
    rememberIdempotent(store, 'inventory.item.create', command.idempotencyKey, id)
    await this.save(await this.load(), store)
    return item
  }

  async updateItem(actor: FinanceActorContext, command: UpdateInventoryItemCommand): Promise<InventoryItem> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'inventory.item.update', this.now())
    const store = cloneInventoryStore(await this.load())
    const idem = replayIdempotent(store, 'inventory.item.update', command.idempotencyKey, (id) => store.items.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    const existing = store.items.get(id)
    if (!existing) throw new InventoryFinanceNotFoundError('Inventory item not found')
    assertExactScope(existing, scope, 'Inventory item')
    if (existing.version !== command.expectedVersion) {
      throw new FinanceValidationError('Inventory item version conflict')
    }

    if (command.trackQuantity === false && existing.trackQuantity && existing.quantityOnHandMilli !== 0) {
      throw new FinanceValidationError('Cannot disable trackQuantity while quantity on hand is non-zero')
    }
    if (command.trackQuantity === true && existing.quantityOnHandMilli < 0) {
      throw new FinanceValidationError('Invalid stock position')
    }

    const cogsAccountId = command.cogsAccountId ?? existing.cogsAccountId
    const inventoryAssetAccountId = command.inventoryAssetAccountId ?? existing.inventoryAssetAccountId
    if (cogsAccountId === inventoryAssetAccountId) {
      throw new FinanceValidationError('COGS account must differ from inventory asset account')
    }

    const at = this.now()
    const next: InventoryItem = {
      ...existing,
      schemaVersion: 1,
      version: existing.version + 1,
      updatedAt: at,
      updatedBy: actor.uid,
      name: command.name !== undefined ? requiredText(command.name, 'name') : existing.name,
      ...(command.description !== undefined
        ? command.description
          ? { description: command.description }
          : { description: undefined }
        : {}),
      incomeAccountId: command.incomeAccountId ? requiredText(command.incomeAccountId, 'incomeAccountId') : existing.incomeAccountId,
      cogsAccountId,
      inventoryAssetAccountId,
      trackQuantity: command.trackQuantity !== undefined ? Boolean(command.trackQuantity) : existing.trackQuantity,
      status: command.status ?? existing.status,
      ...(command.crmInventoryItemId !== undefined
        ? command.crmInventoryItemId
          ? { crmInventoryItemId: command.crmInventoryItemId }
          : { crmInventoryItemId: undefined }
        : {}),
      ...hardGates(),
    }
    // strip undefined description
    if (next.description === undefined) delete (next as { description?: string }).description
    if (next.crmInventoryItemId === undefined) delete (next as { crmInventoryItemId?: string }).crmInventoryItemId

    store.items.set(id, next)
    appendAudit(store, scope, actor, 'inventory.item.updated', 'inventory_item', id, next.version, at, command.requestId, `Updated SKU ${next.sku}`)
    rememberIdempotent(store, 'inventory.item.update', command.idempotencyKey, id)
    await this.save(await this.load(), store)
    return next
  }

  async applyBillReceipt(actor: FinanceActorContext, command: ApplyBillReceiptCommand): Promise<{ movements: StockMovement[]; items: InventoryItem[] }> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'inventory.bill_receipt.apply', this.now())
    const store = cloneInventoryStore(await this.load())
    const batchId = requiredText(command.id, 'id')
    const idem = store.idempotency.get(command.idempotencyKey)
    if (idem) {
      if (idem.operation !== 'inventory.bill_receipt.apply') {
        throw new FinanceValidationError('Idempotency key already used for a different operation')
      }
      const movements = [...store.movements.values()].filter((m) => m.sourceType === 'supplier_bill' && m.sourceId === command.billId)
      const items = movements.map((m) => store.items.get(m.itemId)!).filter(Boolean)
      return { movements, items }
    }

    const billId = requiredText(command.billId, 'billId')
    if (!Array.isArray(command.lines) || command.lines.length === 0) {
      throw new FinanceValidationError('At least one bill receipt line is required')
    }
    parseCanonicalDate(command.receivedAt, 'receivedAt')
    const at = this.now()
    const movements: StockMovement[] = []
    const touched = new Map<string, InventoryItem>()

    for (const [index, line] of command.lines.entries()) {
      const item = resolveItem(store, scope, line)
      if (item.status !== 'active') throw new FinanceValidationError(`Inventory item ${item.sku} is not active`)
      if (!item.trackQuantity) continue

      const lineKey = line.sourceLineId || `line-${index}`
      claim(
        store,
        `bill_receipt:${scope.orgId}:${scope.bookId}:${billId}:${lineKey}`,
        'Bill receipt line already applied to inventory',
      )

      if (!Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0) {
        throw new FinanceValidationError('Bill receipt quantityMilli must be a positive integer')
      }
      if (!Number.isInteger(line.unitCostMinor) || line.unitCostMinor < 0) {
        throw new FinanceValidationError('Bill receipt unitCostMinor must be a non-negative integer')
      }

      const current = touched.get(item.id) || item
      const inbound = applyInboundPosition(
        { quantityOnHandMilli: current.quantityOnHandMilli, inventoryValueMinor: current.inventoryValueMinor },
        line.quantityMilli,
        line.unitCostMinor,
      )
      const nextItem: InventoryItem = {
        ...current,
        schemaVersion: 1,
        version: current.version + 1,
        updatedAt: at,
        updatedBy: actor.uid,
        quantityOnHandMilli: inbound.quantityOnHandMilli,
        inventoryValueMinor: inbound.inventoryValueMinor,
        ...hardGates(),
      }
      store.items.set(nextItem.id, nextItem)
      touched.set(nextItem.id, nextItem)

      const movementId = `mvt-bill-${digest([batchId, billId, lineKey, item.id]).slice(0, 20)}`
      const movement: StockMovement = {
        id: movementId,
        orgId: scope.orgId,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        schemaVersion: 1,
        version: 1,
        createdAt: at,
        createdBy: actor.uid,
        updatedAt: at,
        updatedBy: actor.uid,
        itemId: item.id,
        sku: item.sku,
        direction: 'in',
        reason: 'bill_receipt',
        quantityMilli: line.quantityMilli,
        unitCostMinor: line.unitCostMinor,
        totalCostMinor: inbound.totalCostMinor,
        quantityAfterMilli: inbound.quantityOnHandMilli,
        valueAfterMinor: inbound.inventoryValueMinor,
        sourceType: 'supplier_bill',
        sourceId: billId,
        ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
        ...(command.billNumber ? { sourceDocumentNumber: command.billNumber } : {}),
        movementAt: command.receivedAt,
        actorId: actor.uid,
        ...hardGates(),
      }
      store.movements.set(movementId, movement)
      movements.push(movement)
    }

    appendAudit(
      store,
      scope,
      actor,
      'inventory.bill_receipt.applied',
      'supplier_bill',
      billId,
      1,
      at,
      command.requestId,
      `Applied bill receipt ${command.billNumber || billId} (${movements.length} stock lines)`,
    )
    rememberIdempotent(store, 'inventory.bill_receipt.apply', command.idempotencyKey, batchId)
    // stash batch marker as claim for replay resolution
    store.claims.add(`batch:${batchId}`)
    await this.save(await this.load(), store)
    return { movements, items: [...touched.values()] }
  }

  async applyInvoiceIssue(
    actor: FinanceActorContext,
    command: ApplyInvoiceIssueCommand,
  ): Promise<{ movements: StockMovement[]; cogsPostings: CogsPosting[]; items: InventoryItem[] }> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'inventory.invoice_issue.apply', this.now())
    const store = cloneInventoryStore(await this.load())
    const batchId = requiredText(command.id, 'id')
    const idem = store.idempotency.get(command.idempotencyKey)
    if (idem) {
      if (idem.operation !== 'inventory.invoice_issue.apply') {
        throw new FinanceValidationError('Idempotency key already used for a different operation')
      }
      const movements = [...store.movements.values()].filter((m) => m.sourceType === 'customer_invoice' && m.sourceId === command.invoiceId)
      const cogsPostings = [...store.cogsPostings.values()].filter((c) => c.invoiceId === command.invoiceId)
      const items = movements.map((m) => store.items.get(m.itemId)!).filter(Boolean)
      return { movements, cogsPostings, items }
    }

    const invoiceId = requiredText(command.invoiceId, 'invoiceId')
    if (!Array.isArray(command.lines) || command.lines.length === 0) {
      throw new FinanceValidationError('At least one invoice issue line is required')
    }
    parseCanonicalDate(command.issuedAt, 'issuedAt')
    const at = this.now()
    const movements: StockMovement[] = []
    const cogsPostings: CogsPosting[] = []
    const touched = new Map<string, InventoryItem>()

    for (const [index, line] of command.lines.entries()) {
      const item = resolveItem(store, scope, line)
      if (item.status !== 'active') throw new FinanceValidationError(`Inventory item ${item.sku} is not active`)
      if (!item.trackQuantity) continue

      const lineKey = line.sourceLineId || `line-${index}`
      claim(
        store,
        `invoice_issue:${scope.orgId}:${scope.bookId}:${invoiceId}:${lineKey}`,
        'Invoice issue line already applied to inventory',
      )

      if (!Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0) {
        throw new FinanceValidationError('Invoice issue quantityMilli must be a positive integer')
      }

      const current = touched.get(item.id) || item
      const outbound = applyOutboundPosition(
        { quantityOnHandMilli: current.quantityOnHandMilli, inventoryValueMinor: current.inventoryValueMinor },
        line.quantityMilli,
      )
      const nextItem: InventoryItem = {
        ...current,
        schemaVersion: 1,
        version: current.version + 1,
        updatedAt: at,
        updatedBy: actor.uid,
        quantityOnHandMilli: outbound.quantityOnHandMilli,
        inventoryValueMinor: outbound.inventoryValueMinor,
        ...hardGates(),
      }
      store.items.set(nextItem.id, nextItem)
      touched.set(nextItem.id, nextItem)

      const movementId = `mvt-inv-${digest([batchId, invoiceId, lineKey, item.id]).slice(0, 20)}`
      const cogsId = `cogs-${digest([batchId, invoiceId, lineKey, item.id]).slice(0, 20)}`
      const journal = buildCogsJournalLines({
        cogsAccountId: item.cogsAccountId,
        inventoryAssetAccountId: item.inventoryAssetAccountId,
        cogsMinor: outbound.cogsMinor,
        sku: item.sku,
      })

      let journalEntryId: string | undefined
      const posting: CogsPosting = {
        id: cogsId,
        orgId: scope.orgId,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        schemaVersion: 1,
        version: 1,
        createdAt: at,
        createdBy: actor.uid,
        updatedAt: at,
        updatedBy: actor.uid,
        itemId: item.id,
        sku: item.sku,
        invoiceId,
        ...(line.sourceLineId ? { invoiceLineId: line.sourceLineId } : {}),
        ...(command.invoiceNumber ? { invoiceNumber: command.invoiceNumber } : {}),
        quantityMilli: line.quantityMilli,
        unitCostMinor: outbound.unitCostMinor,
        cogsMinor: outbound.cogsMinor,
        cogsAccountId: item.cogsAccountId,
        inventoryAssetAccountId: item.inventoryAssetAccountId,
        lines: journal.lines,
        balanced: true,
        movementId,
        postedAt: at,
        actorId: actor.uid,
        ...hardGates(),
      }

      if (outbound.cogsMinor > 0) {
        journalEntryId = `je-cogs-${cogsId}`
        const posted = await this.postCogsJournal({
          actor,
          posting: { ...posting, journalEntryId },
          journalEntryId,
          requestId: command.requestId,
          idempotencyKey: `${command.idempotencyKey}:${cogsId}`,
        })
        journalEntryId = posted.id
        posting.journalEntryId = journalEntryId
      }

      store.cogsPostings.set(cogsId, posting)
      cogsPostings.push(posting)

      const movement: StockMovement = {
        id: movementId,
        orgId: scope.orgId,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        schemaVersion: 1,
        version: 1,
        createdAt: at,
        createdBy: actor.uid,
        updatedAt: at,
        updatedBy: actor.uid,
        itemId: item.id,
        sku: item.sku,
        direction: 'out',
        reason: 'invoice_issue',
        quantityMilli: line.quantityMilli,
        unitCostMinor: outbound.unitCostMinor,
        totalCostMinor: outbound.totalCostMinor,
        quantityAfterMilli: outbound.quantityOnHandMilli,
        valueAfterMinor: outbound.inventoryValueMinor,
        sourceType: 'customer_invoice',
        sourceId: invoiceId,
        ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
        ...(command.invoiceNumber ? { sourceDocumentNumber: command.invoiceNumber } : {}),
        movementAt: command.issuedAt,
        cogsPostingId: cogsId,
        ...(journalEntryId ? { journalEntryId } : {}),
        actorId: actor.uid,
        ...hardGates(),
      }
      store.movements.set(movementId, movement)
      movements.push(movement)
    }

    appendAudit(
      store,
      scope,
      actor,
      'inventory.invoice_issue.applied',
      'customer_invoice',
      invoiceId,
      1,
      at,
      command.requestId,
      `Applied invoice issue ${command.invoiceNumber || invoiceId} (${movements.length} stock lines, ${cogsPostings.length} COGS)`,
    )
    rememberIdempotent(store, 'inventory.invoice_issue.apply', command.idempotencyKey, batchId)
    store.claims.add(`batch:${batchId}`)
    await this.save(await this.load(), store)
    return { movements, cogsPostings, items: [...touched.values()] }
  }

  async createAdjustment(actor: FinanceActorContext, command: CreateStockAdjustmentCommand): Promise<StockAdjustment> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'inventory.adjustment.create', this.now())
    const store = cloneInventoryStore(await this.load())
    const idem = replayIdempotent(store, 'inventory.adjustment.create', command.idempotencyKey, (id) => store.adjustments.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.adjustments.has(id)) throw new FinanceValidationError('Adjustment id already exists')
    const item = store.items.get(requiredText(command.itemId, 'itemId'))
    if (!item) throw new InventoryFinanceNotFoundError('Inventory item not found')
    assertExactScope(item, scope, 'Inventory item')
    if (item.version !== command.expectedVersion) throw new FinanceValidationError('Inventory item version conflict')
    if (!item.trackQuantity) throw new FinanceValidationError('Adjustments require trackQuantity')
    if (item.status !== 'active') throw new FinanceValidationError('Inventory item is not active')

    const delta = command.quantityDeltaMilli
    if (!Number.isInteger(delta) || delta === 0) {
      throw new FinanceValidationError('quantityDeltaMilli must be a non-zero integer')
    }
    const reason = requiredText(command.reason, 'reason')
    parseCanonicalDate(command.adjustedAt, 'adjustedAt')
    const at = this.now()

    let nextQty = item.quantityOnHandMilli
    let nextValue = item.inventoryValueMinor
    let unitCostMinor = 0
    let totalCostMinor = 0
    let direction: 'in' | 'out' = 'in'

    if (delta > 0) {
      unitCostMinor = command.unitCostMinor ?? 0
      if (!Number.isInteger(unitCostMinor) || unitCostMinor < 0) {
        throw new FinanceValidationError('unitCostMinor must be a non-negative integer for positive adjustments')
      }
      const inbound = applyInboundPosition(
        { quantityOnHandMilli: item.quantityOnHandMilli, inventoryValueMinor: item.inventoryValueMinor },
        delta,
        unitCostMinor,
      )
      nextQty = inbound.quantityOnHandMilli
      nextValue = inbound.inventoryValueMinor
      totalCostMinor = inbound.totalCostMinor
      direction = 'in'
    } else {
      const qty = Math.abs(delta)
      const outbound = applyOutboundPosition(
        { quantityOnHandMilli: item.quantityOnHandMilli, inventoryValueMinor: item.inventoryValueMinor },
        qty,
      )
      nextQty = outbound.quantityOnHandMilli
      nextValue = outbound.inventoryValueMinor
      totalCostMinor = outbound.totalCostMinor
      unitCostMinor = outbound.unitCostMinor
      direction = 'out'
    }

    const nextItem: InventoryItem = {
      ...item,
      schemaVersion: 1,
      version: item.version + 1,
      updatedAt: at,
      updatedBy: actor.uid,
      quantityOnHandMilli: nextQty,
      inventoryValueMinor: nextValue,
      ...hardGates(),
    }
    store.items.set(item.id, nextItem)

    const movementId = `mvt-adj-${id}`
    const movement: StockMovement = {
      id: movementId,
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: at,
      createdBy: actor.uid,
      updatedAt: at,
      updatedBy: actor.uid,
      itemId: item.id,
      sku: item.sku,
      direction,
      reason: 'adjustment',
      quantityMilli: Math.abs(delta),
      unitCostMinor,
      totalCostMinor,
      quantityAfterMilli: nextQty,
      valueAfterMinor: nextValue,
      sourceType: 'adjustment',
      sourceId: id,
      movementAt: command.adjustedAt,
      actorId: actor.uid,
      note: reason,
      ...hardGates(),
    }
    store.movements.set(movementId, movement)

    const adjustment: StockAdjustment = {
      id,
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: at,
      createdBy: actor.uid,
      updatedAt: at,
      updatedBy: actor.uid,
      itemId: item.id,
      sku: item.sku,
      quantityDeltaMilli: delta,
      ...(delta > 0 ? { unitCostMinor } : { unitCostMinor }),
      totalCostMinor,
      reason,
      movementId,
      adjustedAt: command.adjustedAt,
      actorId: actor.uid,
      ...hardGates(),
    }
    store.adjustments.set(id, adjustment)
    appendAudit(store, scope, actor, 'inventory.adjustment.created', 'stock_adjustment', id, 1, at, command.requestId, `Adjustment ${item.sku}: ${delta}`)
    rememberIdempotent(store, 'inventory.adjustment.create', command.idempotencyKey, id)
    await this.save(await this.load(), store)
    return adjustment
  }

  async getItem(actor: FinanceActorContext, scope: Required<FinanceScope>, itemId: string): Promise<InventoryItem> {
    authorizeFinanceAction(actor, scope, 'inventory.read', this.now())
    const store = await this.load()
    const item = store.items.get(requiredText(itemId, 'itemId'))
    if (!item) throw new InventoryFinanceNotFoundError('Inventory item not found')
    assertExactScope(item, scope, 'Inventory item')
    return item
  }

  async stockOnHandReport(actor: FinanceActorContext, scope: Required<FinanceScope>): Promise<StockOnHandReport> {
    authorizeFinanceAction(actor, scope, 'inventory.report.read', this.now())
    const store = await this.load()
    return buildStockOnHand(store, scope, this.now())
  }

  async listBundle(actor: FinanceActorContext, scope: Required<FinanceScope>): Promise<InventoryBundle> {
    authorizeFinanceAction(actor, scope, 'inventory.read', this.now())
    const store = await this.load()
    const inScope = <T extends { orgId: string; legalEntityId: string; bookId: string }>(rows: T[]) =>
      rows.filter((r) => r.orgId === scope.orgId && r.legalEntityId === scope.legalEntityId && r.bookId === scope.bookId)

    const items = inScope([...store.items.values()]).sort((a, b) => a.sku.localeCompare(b.sku))
    const movements = inScope([...store.movements.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200)
    const adjustments = inScope([...store.adjustments.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    const cogsPostings = inScope([...store.cogsPostings.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    const recentAudit = inScope([...store.auditEvents.values()]).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50)
    return {
      items,
      movements,
      adjustments,
      cogsPostings,
      recentAudit,
      stockOnHand: buildStockOnHand(store, scope, this.now()),
    }
  }
}

export class InMemoryInventoryFinanceService extends InventoryFinanceService {
  readonly storeRef: { current: InventoryFinanceStore }

  constructor(
    store: InventoryFinanceStore = createEmptyInventoryStore(),
    now: () => string = () => '2026-08-03T12:00:00.000Z',
    postCogsJournal?: CogsJournalPoster,
  ) {
    const storeRef = { current: store }
    super(
      async () => cloneInventoryStore(storeRef.current),
      async (_before, after) => {
        storeRef.current = cloneInventoryStore(after)
      },
      postCogsJournal,
      now,
    )
    this.storeRef = storeRef
  }
}
