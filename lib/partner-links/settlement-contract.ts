export type SettlementOperation = 'notice' | 'confirm' | 'dispute'

export interface CanonicalSettlementPair {
  partnerLinkId: string
  tradeOrderId: string
  issuerOrgId: string
  recipientOrgId: string
  supplierOrderId: string
  buyerOrderId: string
  tradeTermsHash: string
}

export interface StoredSettlementOperation {
  operation?: unknown
  idempotencyKey?: unknown
  fingerprint?: unknown
  resultState?: unknown
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fail(detail: string): never {
  throw new Error(`Canonical partner settlement required: ${detail}`)
}

/**
 * Validates the immutable financial boundary between a partner invoice and its
 * two mirrored trade orders. It deliberately has no linkedOrgId, allowedOrgIds,
 * or "active source org" fallback: only the canonical reciprocal records count.
 */
export function validateCanonicalSettlementPair(input: {
  invoice: Record<string, unknown>
  orders: Array<Record<string, unknown>>
  relationships: Array<Record<string, unknown>>
}): CanonicalSettlementPair {
  const { invoice, orders, relationships } = input
  const issuerOrgId = clean(invoice.issuerOrgId)
  const invoiceOrgId = clean(invoice.orgId)
  const recipientOrgId = clean(invoice.recipientOrgId)
  const partnerLinkId = clean(invoice.partnerLinkId)
  const tradeOrderId = clean(invoice.tradeOrderId)
  const supplierOrderId = clean(invoice.supplierOrderId)
  const buyerOrderId = clean(invoice.buyerOrderId)
  const tradeTermsHash = clean(invoice.tradeTermsHash)

  if (!issuerOrgId || issuerOrgId !== invoiceOrgId || !recipientOrgId || issuerOrgId === recipientOrgId) {
    fail('invoice issuer and recipient must be explicit and exact')
  }
  if (!partnerLinkId || !tradeOrderId || !supplierOrderId || !buyerOrderId || !tradeTermsHash) {
    fail('invoice immutable trade binding is incomplete')
  }

  if (relationships.length !== 2) fail('exactly two reciprocal relationship rows are required')
  const relationshipDirections = new Set<string>()
  for (const row of relationships) {
    if (row.deleted === true || clean(row.status) !== 'active' || clean(row.partnerLinkId) !== partnerLinkId) {
      fail('relationship row is not an active partnerLinkId match')
    }
    const sourceOrgId = clean(row.sourceOrgId)
    const targetOrgId = clean(row.targetOrgId)
    if (!sourceOrgId || !targetOrgId || sourceOrgId === targetOrgId) fail('relationship direction is invalid')
    relationshipDirections.add(`${sourceOrgId}->${targetOrgId}`)
  }
  if (relationshipDirections.size !== 2 ||
      !relationshipDirections.has(`${issuerOrgId}->${recipientOrgId}`) ||
      !relationshipDirections.has(`${recipientOrgId}->${issuerOrgId}`)) {
    fail('relationship rows are not reciprocal for the invoice parties')
  }

  if (orders.length !== 2) fail('exactly two mirrored orders are required')
  const sales = orders.find((row) => clean(row.direction) === 'sales')
  const purchase = orders.find((row) => clean(row.direction) === 'purchase')
  if (!sales || !purchase) fail('one sales and one purchase order are required')
  for (const order of orders) {
    if (order.deleted === true ||
        clean(order.tradeOrderId) !== tradeOrderId ||
        clean(order.partnerLinkId) !== partnerLinkId ||
        clean(order.termsHash) !== tradeTermsHash) {
      fail('order does not match the immutable invoice trade binding')
    }
  }
  if (clean(sales.id) !== supplierOrderId || clean(purchase.id) !== buyerOrderId ||
      clean(sales.orgId) !== issuerOrgId || clean(sales.counterpartyOrgId) !== recipientOrgId ||
      clean(purchase.orgId) !== recipientOrgId || clean(purchase.counterpartyOrgId) !== issuerOrgId ||
      clean(sales.counterpartOrderId) !== buyerOrderId || clean(purchase.counterpartOrderId) !== supplierOrderId) {
    fail('orders are not an exact reciprocal issuer/recipient pair')
  }

  return { partnerLinkId, tradeOrderId, issuerOrgId, recipientOrgId, supplierOrderId, buyerOrderId, tradeTermsHash }
}

/**
 * State transitions may replay only the exact operation and immutable request
 * fingerprint. A reused key with changed intent is a security error, never a
 * new mutation.
 */
export function resolveSettlementIdempotency(
  existing: StoredSettlementOperation | null | undefined,
  requested: { operation: SettlementOperation; idempotencyKey: string; fingerprint: string },
): { replay: true; resultState: string } | { replay: false } {
  const key = clean(requested.idempotencyKey)
  const fingerprint = clean(requested.fingerprint)
  if (!key || !fingerprint) throw new Error('Idempotency key and request fingerprint are required')
  if (key.length > 200) throw new Error('Idempotency key is too long')
  if (!existing || !clean(existing.idempotencyKey)) return { replay: false }
  if (clean(existing.idempotencyKey) !== key) return { replay: false }
  if (clean(existing.operation) !== requested.operation || clean(existing.fingerprint) !== fingerprint) {
    throw new Error('Idempotency key was already used for a different settlement operation')
  }
  const resultState = clean(existing.resultState)
  if (!resultState) throw new Error('Idempotent settlement record is incomplete and requires reconciliation')
  return { replay: true, resultState }
}
