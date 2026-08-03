import { FinanceValidationError, parseCanonicalDate, requiredText } from './foundation'
import type { DepreciationScheduleLine, FixedAsset } from './assets-types'

export { FinanceValidationError }

const PERIOD_KEY = /^(\d{4})-(\d{2})$/

export function assertNonNegativeMinor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative safe integer in minor units`)
  }
  return value
}

export function assertPositiveMinor(value: number, field: string): number {
  const n = assertNonNegativeMinor(value, field)
  if (n <= 0) throw new FinanceValidationError(`${field} must be positive`)
  return n
}

export function assertUsefulLifeMonths(value: number, field = 'usefulLifeMonths'): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1200) {
    throw new FinanceValidationError(`${field} must be an integer between 1 and 1200`)
  }
  return value
}

export function parsePeriodKey(periodKey: string): { year: number; month: number; key: string } {
  const key = requiredText(periodKey, 'periodKey')
  const match = PERIOD_KEY.exec(key)
  if (!match) throw new FinanceValidationError('periodKey must be YYYY-MM')
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) throw new FinanceValidationError('periodKey month must be 01-12')
  return { year, month, key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` }
}

export function periodKeyFromDate(isoDate: string, field = 'date'): string {
  const epoch = parseCanonicalDate(isoDate, field)
  const d = new Date(epoch)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function comparePeriodKeys(a: string, b: string): number {
  const left = parsePeriodKey(a)
  const right = parsePeriodKey(b)
  if (left.year !== right.year) return left.year - right.year
  return left.month - right.month
}

export function addMonthsToPeriodKey(periodKey: string, delta: number): string {
  const { year, month } = parsePeriodKey(periodKey)
  const absolute = year * 12 + (month - 1) + delta
  const nextYear = Math.floor(absolute / 12)
  const nextMonth = (absolute % 12) + 1
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`
}

export function depreciableBaseMinor(costMinor: number, residualValueMinor: number): number {
  assertNonNegativeMinor(costMinor, 'costMinor')
  assertNonNegativeMinor(residualValueMinor, 'residualValueMinor')
  if (residualValueMinor > costMinor) {
    throw new FinanceValidationError('residualValueMinor cannot exceed costMinor')
  }
  return costMinor - residualValueMinor
}

/**
 * Straight-line schedule in minor units.
 * Months 1..N-1 use floor(base/N); final month absorbs remainder so sum === base.
 */
export function buildStraightLineSchedule(input: {
  costMinor: number
  residualValueMinor: number
  usefulLifeMonths: number
  inServiceDate: string
}): DepreciationScheduleLine[] {
  const life = assertUsefulLifeMonths(input.usefulLifeMonths)
  const base = depreciableBaseMinor(input.costMinor, input.residualValueMinor)
  parseCanonicalDate(input.inServiceDate, 'inServiceDate')
  const startKey = periodKeyFromDate(input.inServiceDate, 'inServiceDate')

  if (base === 0) {
    return Array.from({ length: life }, (_, i) => ({
      periodIndex: i + 1,
      periodKey: addMonthsToPeriodKey(startKey, i),
      amountMinor: 0,
      cumulativeMinor: 0,
      closingNbvMinor: input.costMinor,
    }))
  }

  const regular = Math.floor(base / life)
  let cumulative = 0
  const lines: DepreciationScheduleLine[] = []
  for (let i = 1; i <= life; i += 1) {
    const amountMinor = i === life ? base - cumulative : regular
    cumulative += amountMinor
    lines.push({
      periodIndex: i,
      periodKey: addMonthsToPeriodKey(startKey, i - 1),
      amountMinor,
      cumulativeMinor: cumulative,
      closingNbvMinor: input.costMinor - cumulative,
    })
  }
  return lines
}

export function scheduleLineForPeriod(
  asset: Pick<FixedAsset, 'costMinor' | 'residualValueMinor' | 'usefulLifeMonths' | 'inServiceDate' | 'depreciationMethod'>,
  periodKey: string,
): DepreciationScheduleLine | null {
  if (asset.depreciationMethod !== 'straight_line') {
    throw new FinanceValidationError('Only straight_line depreciation is supported')
  }
  parsePeriodKey(periodKey)
  const schedule = buildStraightLineSchedule(asset)
  return schedule.find((line) => line.periodKey === periodKey) ?? null
}

export function nextOpenPeriodIndex(asset: Pick<FixedAsset, 'lastDepreciationPeriodKey' | 'inServiceDate' | 'usefulLifeMonths' | 'costMinor' | 'residualValueMinor' | 'depreciationMethod'>): number {
  const schedule = buildStraightLineSchedule(asset)
  if (!asset.lastDepreciationPeriodKey) return 1
  const last = schedule.find((line) => line.periodKey === asset.lastDepreciationPeriodKey)
  if (!last) throw new FinanceValidationError('lastDepreciationPeriodKey is not on the asset schedule')
  return last.periodIndex + 1
}

export function netBookValueMinor(costMinor: number, accumulatedDepreciationMinor: number): number {
  assertNonNegativeMinor(costMinor, 'costMinor')
  assertNonNegativeMinor(accumulatedDepreciationMinor, 'accumulatedDepreciationMinor')
  if (accumulatedDepreciationMinor > costMinor) {
    throw new FinanceValidationError('accumulatedDepreciationMinor cannot exceed costMinor')
  }
  return costMinor - accumulatedDepreciationMinor
}

export function computeDisposalGainLoss(input: {
  proceedsMinor: number
  nbvAtDisposalMinor: number
}): number {
  assertNonNegativeMinor(input.proceedsMinor, 'proceedsMinor')
  assertNonNegativeMinor(input.nbvAtDisposalMinor, 'nbvAtDisposalMinor')
  return input.proceedsMinor - input.nbvAtDisposalMinor
}

export function assertAssetActiveForDepreciation(asset: FixedAsset, periodKey: string): void {
  if (asset.status !== 'active') {
    throw new FinanceValidationError('Only active assets can be depreciated')
  }
  parsePeriodKey(periodKey)
  const inServiceKey = periodKeyFromDate(asset.inServiceDate, 'inServiceDate')
  if (comparePeriodKeys(periodKey, inServiceKey) < 0) {
    throw new FinanceValidationError('Cannot depreciate before the in-service period')
  }
  if (asset.lastDepreciationPeriodKey && comparePeriodKeys(periodKey, asset.lastDepreciationPeriodKey) <= 0) {
    throw new FinanceValidationError('Depreciation period is already posted for this asset')
  }
  const expectedNext = asset.lastDepreciationPeriodKey
    ? addMonthsToPeriodKey(asset.lastDepreciationPeriodKey, 1)
    : inServiceKey
  if (periodKey !== expectedNext) {
    throw new FinanceValidationError(`Next open depreciation period for asset is ${expectedNext}`)
  }
}
