interface DealLineItemLike {
  qty?: number
  unitPrice?: number
  total?: number
}

export function lineItemDisplayTotal(lineItem: DealLineItemLike): number {
  if (Number.isFinite(lineItem.total)) return lineItem.total ?? 0
  return (lineItem.qty ?? 0) * (lineItem.unitPrice ?? 0)
}

export function lineItemsDisplayTotal(lineItems: DealLineItemLike[]): number {
  return lineItems.reduce((sum, lineItem) => sum + lineItemDisplayTotal(lineItem), 0)
}
