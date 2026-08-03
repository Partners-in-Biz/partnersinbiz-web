import { FinanceValidationError } from './foundation'

export { FinanceValidationError }

/** Half-up total cost for quantityMilli at unitCostMinor (unit = 1000 milli). */
export function costForQuantityMilli(unitCostMinor: number, quantityMilli: number): number {
  assertNonNegativeInt(unitCostMinor, 'unitCostMinor')
  assertPositiveInt(quantityMilli, 'quantityMilli')
  return Number((BigInt(unitCostMinor) * BigInt(quantityMilli) + 500n) / 1000n)
}

/** Weighted-average unit cost in minor units; 0 when no quantity. */
export function averageUnitCostMinor(inventoryValueMinor: number, quantityOnHandMilli: number): number {
  assertNonNegativeInt(inventoryValueMinor, 'inventoryValueMinor')
  if (quantityOnHandMilli === 0) return 0
  if (quantityOnHandMilli < 0) throw new FinanceValidationError('quantityOnHandMilli cannot be negative')
  return Number((BigInt(inventoryValueMinor) * 1000n + BigInt(quantityOnHandMilli) / 2n) / BigInt(quantityOnHandMilli))
}

export interface StockPosition {
  quantityOnHandMilli: number
  inventoryValueMinor: number
}

export function applyInboundPosition(
  current: StockPosition,
  quantityMilli: number,
  unitCostMinor: number,
): StockPosition & { totalCostMinor: number; averageUnitCostMinor: number } {
  assertNonNegativeInt(current.quantityOnHandMilli, 'quantityOnHandMilli')
  assertNonNegativeInt(current.inventoryValueMinor, 'inventoryValueMinor')
  const totalCostMinor = costForQuantityMilli(unitCostMinor, quantityMilli)
  const quantityOnHandMilli = current.quantityOnHandMilli + quantityMilli
  const inventoryValueMinor = current.inventoryValueMinor + totalCostMinor
  return {
    quantityOnHandMilli,
    inventoryValueMinor,
    totalCostMinor,
    averageUnitCostMinor: averageUnitCostMinor(inventoryValueMinor, quantityOnHandMilli),
  }
}

export function applyOutboundPosition(
  current: StockPosition,
  quantityMilli: number,
): StockPosition & { totalCostMinor: number; unitCostMinor: number; cogsMinor: number } {
  assertNonNegativeInt(current.quantityOnHandMilli, 'quantityOnHandMilli')
  assertNonNegativeInt(current.inventoryValueMinor, 'inventoryValueMinor')
  assertPositiveInt(quantityMilli, 'quantityMilli')
  if (quantityMilli > current.quantityOnHandMilli) {
    throw new FinanceValidationError('Insufficient quantity on hand')
  }
  const unitCostMinor = averageUnitCostMinor(current.inventoryValueMinor, current.quantityOnHandMilli)
  let totalCostMinor: number
  if (quantityMilli === current.quantityOnHandMilli) {
    totalCostMinor = current.inventoryValueMinor
  } else {
    totalCostMinor = costForQuantityMilli(unitCostMinor, quantityMilli)
    if (totalCostMinor > current.inventoryValueMinor) totalCostMinor = current.inventoryValueMinor
  }
  const quantityOnHandMilli = current.quantityOnHandMilli - quantityMilli
  const inventoryValueMinor = current.inventoryValueMinor - totalCostMinor
  return {
    quantityOnHandMilli,
    inventoryValueMinor,
    totalCostMinor,
    unitCostMinor,
    cogsMinor: totalCostMinor,
  }
}

export function buildCogsJournalLines(input: {
  cogsAccountId: string
  inventoryAssetAccountId: string
  cogsMinor: number
  sku: string
}): { lines: Array<{ accountId: string; debitMinor: number; creditMinor: number; description: string }>; balanced: true } {
  const cogsMinor = input.cogsMinor
  assertNonNegativeInt(cogsMinor, 'cogsMinor')
  if (cogsMinor === 0) {
    return { lines: [], balanced: true }
  }
  if (!input.cogsAccountId || !input.inventoryAssetAccountId) {
    throw new FinanceValidationError('COGS and inventory asset accounts are required')
  }
  if (input.cogsAccountId === input.inventoryAssetAccountId) {
    throw new FinanceValidationError('COGS account must differ from inventory asset account')
  }
  const lines = [
    {
      accountId: input.cogsAccountId,
      debitMinor: cogsMinor,
      creditMinor: 0,
      description: `COGS ${input.sku}`,
    },
    {
      accountId: input.inventoryAssetAccountId,
      debitMinor: 0,
      creditMinor: cogsMinor,
      description: `Inventory relief ${input.sku}`,
    },
  ]
  const debits = lines.reduce((s, l) => s + l.debitMinor, 0)
  const credits = lines.reduce((s, l) => s + l.creditMinor, 0)
  if (debits !== credits) throw new FinanceValidationError('COGS journal is not balanced')
  return { lines, balanced: true }
}

function assertNonNegativeInt(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative integer`)
  }
}

function assertPositiveInt(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new FinanceValidationError(`${field} must be a positive integer`)
  }
}
