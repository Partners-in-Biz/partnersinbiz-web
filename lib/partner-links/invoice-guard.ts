function hasCanonicalPartnerTradeBinding(record: Record<string, unknown>): boolean {
  return typeof record.partnerLinkId === 'string' && record.partnerLinkId.trim().length > 0 &&
    typeof record.tradeOrderId === 'string' && record.tradeOrderId.trim().length > 0
}

export function isCanonicalPartnerTradeInvoice(invoice: Record<string, unknown>): boolean {
  return hasCanonicalPartnerTradeBinding(invoice)
}

export function isCanonicalPartnerTradeOrder(order: Record<string, unknown>): boolean {
  return hasCanonicalPartnerTradeBinding(order)
}

/**
 * Partner-trade invoices are immutable settlement anchors. Their payment and
 * lifecycle transitions must go through the canonical partner-settlements
 * transaction, never a generic invoice mutation route.
 */
export function rejectGenericPartnerTradeMutation(invoice: Record<string, unknown>): string | null {
  return isCanonicalPartnerTradeInvoice(invoice)
    ? 'Partner-trade invoices are immutable settlement records. Use the partner settlement flow.'
    : null
}

/** Mirrored trade orders are immutable commercial evidence until settlement. */
export function rejectGenericPartnerTradeOrderMutation(order: Record<string, unknown>): string | null {
  return isCanonicalPartnerTradeOrder(order)
    ? 'Partner-trade orders are immutable settlement records. Use the partner settlement flow.'
    : null
}
