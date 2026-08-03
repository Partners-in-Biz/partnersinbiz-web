import { FinanceValidationError, parseCanonicalDate, requiredText } from './foundation'
import type {
  RevenueRecognitionMethod,
  RevenueSchedule,
  RevenueScheduleLine,
} from './revenue-recognition-types'

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

export function assertRecognitionMethod(method: string): RevenueRecognitionMethod {
  if (method !== 'straight_line' && method !== 'milestone') {
    throw new FinanceValidationError('method must be straight_line or milestone')
  }
  return method
}

/**
 * Straight-line revenue schedule in minor units.
 * Months 1..N-1 use floor(total/N); final month absorbs remainder so sum === total.
 */
export function buildStraightLineRevenueSchedule(input: {
  totalContractMinor: number
  months: number
  startDate: string
  scheduleId: string
}): RevenueScheduleLine[] {
  const total = assertPositiveMinor(input.totalContractMinor, 'totalContractMinor')
  if (!Number.isSafeInteger(input.months) || input.months < 1 || input.months > 1200) {
    throw new FinanceValidationError('months must be an integer between 1 and 1200')
  }
  parseCanonicalDate(input.startDate, 'startDate')
  const startKey = periodKeyFromDate(input.startDate, 'startDate')
  const months = input.months
  const regular = Math.floor(total / months)
  let cumulative = 0
  const lines: RevenueScheduleLine[] = []
  for (let i = 1; i <= months; i += 1) {
    const amountMinor = i === months ? total - cumulative : regular
    cumulative += amountMinor
    lines.push({
      lineId: `${input.scheduleId}_L${String(i).padStart(3, '0')}`,
      periodIndex: i,
      periodKey: addMonthsToPeriodKey(startKey, i - 1),
      amountMinor,
      cumulativeMinor: cumulative,
      status: 'pending',
    })
  }
  return lines
}

export function buildMilestoneRevenueSchedule(input: {
  scheduleId: string
  milestones: Array<{ code: string; name?: string; amountMinor: number; periodKey?: string }>
  totalContractMinor: number
}): RevenueScheduleLine[] {
  const total = assertPositiveMinor(input.totalContractMinor, 'totalContractMinor')
  if (!input.milestones?.length) throw new FinanceValidationError('milestones are required for milestone method')
  let cumulative = 0
  const lines: RevenueScheduleLine[] = []
  const codes = new Set<string>()
  input.milestones.forEach((m, idx) => {
    const code = requiredText(m.code, 'milestone.code').toUpperCase()
    if (codes.has(code)) throw new FinanceValidationError(`Duplicate milestone code ${code}`)
    codes.add(code)
    const amountMinor = assertPositiveMinor(m.amountMinor, 'milestone.amountMinor')
    cumulative += amountMinor
    if (m.periodKey) parsePeriodKey(m.periodKey)
    lines.push({
      lineId: `${input.scheduleId}_M${String(idx + 1).padStart(3, '0')}`,
      periodIndex: idx + 1,
      ...(m.periodKey ? { periodKey: parsePeriodKey(m.periodKey).key } : {}),
      milestoneCode: code,
      ...(m.name?.trim() ? { milestoneName: m.name.trim() } : {}),
      amountMinor,
      cumulativeMinor: cumulative,
      status: 'pending',
    })
  })
  if (cumulative !== total) {
    throw new FinanceValidationError(
      `Milestone amounts must sum to totalContractMinor (got ${cumulative}, expected ${total})`,
    )
  }
  return lines
}

export function scheduleLinesTotal(lines: RevenueScheduleLine[]): number {
  return lines.reduce((s, l) => s + l.amountMinor, 0)
}

export function deferredBalanceFrom(schedule: Pick<RevenueSchedule, 'billedMinor' | 'recognizedMinor'>): number {
  assertNonNegativeMinor(schedule.billedMinor, 'billedMinor')
  assertNonNegativeMinor(schedule.recognizedMinor, 'recognizedMinor')
  if (schedule.recognizedMinor > schedule.billedMinor) {
    throw new FinanceValidationError('recognizedMinor cannot exceed billedMinor')
  }
  return schedule.billedMinor - schedule.recognizedMinor
}

/** Lines eligible for a period recognition run. */
export function pendingLinesForPeriod(
  schedule: Pick<RevenueSchedule, 'method' | 'status' | 'lines'>,
  periodKey: string,
  options?: { milestoneCodes?: string[] },
): RevenueScheduleLine[] {
  if (schedule.status !== 'active') return []
  parsePeriodKey(periodKey)
  const pending = schedule.lines.filter((l) => l.status === 'pending')
  if (schedule.method === 'straight_line') {
    return pending.filter((l) => l.periodKey === periodKey)
  }
  // milestone: include lines whose periodKey matches, or explicit codes for this run
  const codes = new Set((options?.milestoneCodes || []).map((c) => c.toUpperCase()))
  return pending.filter((l) => {
    if (l.periodKey && l.periodKey === periodKey) return true
    if (codes.size > 0 && l.milestoneCode && codes.has(l.milestoneCode)) return true
    return false
  })
}

export function buildRecognitionJournalLines(input: {
  deferredRevenueAccountId: string
  revenueAccountId: string
  amountMinor: number
  description: string
}): Array<{ accountId: string; debitMinor: number; creditMinor: number; description: string }> {
  const amount = assertPositiveMinor(input.amountMinor, 'amountMinor')
  const deferred = requiredText(input.deferredRevenueAccountId, 'deferredRevenueAccountId')
  const revenue = requiredText(input.revenueAccountId, 'revenueAccountId')
  if (deferred === revenue) {
    throw new FinanceValidationError('deferredRevenueAccountId and revenueAccountId must differ')
  }
  return [
    { accountId: deferred, debitMinor: amount, creditMinor: 0, description: input.description || 'Recognize deferred revenue' },
    { accountId: revenue, debitMinor: 0, creditMinor: amount, description: input.description || 'Revenue recognition' },
  ]
}

export function buildReversalJournalLines(input: {
  deferredRevenueAccountId: string
  revenueAccountId: string
  amountMinor: number
  description: string
}): Array<{ accountId: string; debitMinor: number; creditMinor: number; description: string }> {
  const amount = assertPositiveMinor(input.amountMinor, 'amountMinor')
  const deferred = requiredText(input.deferredRevenueAccountId, 'deferredRevenueAccountId')
  const revenue = requiredText(input.revenueAccountId, 'revenueAccountId')
  return [
    { accountId: revenue, debitMinor: amount, creditMinor: 0, description: input.description || 'Reverse revenue recognition' },
    { accountId: deferred, debitMinor: 0, creditMinor: amount, description: input.description || 'Restore deferred revenue' },
  ]
}

export function recognizedBps(recognizedMinor: number, billedMinor: number): number {
  assertNonNegativeMinor(recognizedMinor, 'recognizedMinor')
  assertNonNegativeMinor(billedMinor, 'billedMinor')
  if (billedMinor === 0) return 0
  return Math.floor((recognizedMinor * 10_000) / billedMinor)
}
