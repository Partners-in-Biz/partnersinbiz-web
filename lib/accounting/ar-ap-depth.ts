import {
  FinanceValidationError,
  assertMinorUnits,
  assertSafeInteger,
  parseCanonicalDate,
} from './foundation'
import { assertPositiveMinor } from './documents'

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export function daysBetweenIsoDates(fromDate: string, toDate: string): number {
  const from = parseCanonicalDate(fromDate, 'fromDate')
  const to = parseCanonicalDate(toDate, 'toDate')
  return Math.floor((to - from) / (24 * 60 * 60 * 1000))
}

export function agingBucketForDaysPastDue(daysPastDue: number): AgingBucketKey {
  if (daysPastDue <= 0) return 'current'
  if (daysPastDue <= 30) return 'd1_30'
  if (daysPastDue <= 60) return 'd31_60'
  if (daysPastDue <= 90) return 'd61_90'
  return 'd90_plus'
}

export function emptyAgingBuckets(): Array<{ key: AgingBucketKey; label: string; amountMinor: number; count: number }> {
  return [
    { key: 'current', label: 'Current', amountMinor: 0, count: 0 },
    { key: 'd1_30', label: '1–30', amountMinor: 0, count: 0 },
    { key: 'd31_60', label: '31–60', amountMinor: 0, count: 0 },
    { key: 'd61_90', label: '61–90', amountMinor: 0, count: 0 },
    { key: 'd90_plus', label: '90+', amountMinor: 0, count: 0 },
  ]
}

export function buildAgingReport(input: {
  asOfDate: string
  currency: string
  role: 'customer' | 'supplier'
  openItems: ReadonlyArray<{
    id: string
    sourceType: string
    sourceId: string
    counterpartyCompanyId: string
    counterpartyRole: 'customer' | 'supplier'
    currency: string
    outstandingMinor: number
    dueDate: string
    status: string
  }>
}) {
  parseCanonicalDate(input.asOfDate, 'asOfDate')
  const buckets = emptyAgingBuckets()
  const items: Array<{
    openItemId: string
    sourceType: string
    sourceId: string
    counterpartyCompanyId: string
    dueDate: string
    outstandingMinor: number
    daysPastDue: number
    bucket: AgingBucketKey
  }> = []
  let totalOutstandingMinor = 0
  for (const item of input.openItems) {
    if (item.counterpartyRole !== input.role) continue
    if (item.status === 'closed' || item.status === 'voided') continue
    if (item.currency !== input.currency) continue
    if (!Number.isSafeInteger(item.outstandingMinor) || item.outstandingMinor <= 0) continue
    const daysPastDue = daysBetweenIsoDates(item.dueDate, input.asOfDate)
    const bucket = agingBucketForDaysPastDue(daysPastDue)
    const row = buckets.find((b) => b.key === bucket)!
    row.amountMinor += item.outstandingMinor
    row.count += 1
    totalOutstandingMinor += item.outstandingMinor
    items.push({
      openItemId: item.id,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      counterpartyCompanyId: item.counterpartyCompanyId,
      dueDate: item.dueDate,
      outstandingMinor: item.outstandingMinor,
      daysPastDue,
      bucket,
    })
  }
  items.sort((a, b) => b.daysPastDue - a.daysPastDue || a.dueDate.localeCompare(b.dueDate))
  return {
    role: input.role,
    asOfDate: input.asOfDate,
    currency: input.currency,
    buckets,
    totalOutstandingMinor,
    items,
  }
}

export function addCalendarDays(isoDate: string, days: number): string {
  const epoch = parseCanonicalDate(isoDate, 'isoDate')
  const date = new Date(epoch)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function nextRecurringRunDate(currentRunDate: string, frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'): string {
  const date = new Date(parseCanonicalDate(currentRunDate, 'currentRunDate'))
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7)
  else if (frequency === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1)
  else if (frequency === 'quarterly') date.setUTCMonth(date.getUTCMonth() + 3)
  else if (frequency === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1)
  else throw new FinanceValidationError('Unsupported recurring frequency')
  return date.toISOString().slice(0, 10)
}

export function projectCreditNoteStatus(totalMinor: number, remainingMinor: number, current: string): string {
  if (current === 'voided' || current === 'draft') return current
  assertMinorUnits(totalMinor, 'totalMinor')
  assertMinorUnits(remainingMinor, 'remainingMinor')
  if (remainingMinor > totalMinor) throw new FinanceValidationError('remainingMinor cannot exceed totalMinor')
  if (remainingMinor === 0) return 'applied'
  if (remainingMinor === totalMinor) return 'issued'
  return 'partially_applied'
}

export function assertNoteApplicationAmount(noteRemainingMinor: number, targetOutstandingMinor: number, appliedMinor: number): void {
  assertPositiveMinor(appliedMinor, 'appliedMinor')
  assertMinorUnits(noteRemainingMinor, 'noteRemainingMinor')
  assertMinorUnits(targetOutstandingMinor, 'targetOutstandingMinor')
  if (appliedMinor > noteRemainingMinor) throw new FinanceValidationError('Application exceeds note remaining amount')
  if (appliedMinor > targetOutstandingMinor) throw new FinanceValidationError('Application exceeds target outstanding amount')
}

export function buildStatementBalances(input: {
  openingBalanceMinor: number
  lines: ReadonlyArray<{ debitMinor: number; creditMinor: number }>
}): { closingBalanceMinor: number; running: number[] } {
  if (!Number.isSafeInteger(input.openingBalanceMinor)) {
    throw new FinanceValidationError('openingBalanceMinor must be a safe integer')
  }
  let balance = input.openingBalanceMinor
  const running: number[] = []
  for (const [index, line] of input.lines.entries()) {
    assertMinorUnits(line.debitMinor, `lines[${index}].debitMinor`)
    assertMinorUnits(line.creditMinor, `lines[${index}].creditMinor`)
    if (line.debitMinor > 0 && line.creditMinor > 0) {
      throw new FinanceValidationError('Statement line cannot have both debit and credit')
    }
    balance += line.debitMinor - line.creditMinor
    if (!Number.isSafeInteger(balance)) throw new FinanceValidationError('Statement balance exceeds safe integer precision')
    running.push(balance)
  }
  return { closingBalanceMinor: balance, running }
}

export function renderStatementCsv(input: {
  role: string
  counterpartyName: string
  fromDate: string
  toDate: string
  currency: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  lines: ReadonlyArray<{
    date: string
    documentType: string
    documentNumber?: string
    description: string
    debitMinor: number
    creditMinor: number
    balanceMinor: number
  }>
}): string {
  const header = ['date', 'documentType', 'documentNumber', 'description', 'debitMinor', 'creditMinor', 'balanceMinor'].join(',')
  const rows = input.lines.map((line) => [
    line.date,
    line.documentType,
    line.documentNumber ?? '',
    JSON.stringify(line.description),
    String(line.debitMinor),
    String(line.creditMinor),
    String(line.balanceMinor),
  ].join(','))
  return [
    `# ${input.role} statement for ${JSON.stringify(input.counterpartyName)}`,
    `# period ${input.fromDate} to ${input.toDate} currency ${input.currency}`,
    `# opening ${input.openingBalanceMinor} closing ${input.closingBalanceMinor}`,
    `# massEmailAllowed=false autoSend=false externalEgressAllowed=false`,
    header,
    ...rows,
  ].join('\n')
}

export function filterDocumentsByPortalFilters<T extends {
  status?: string
  issueDate?: string
  dueDate?: string
  documentNumber?: string
  outstandingMinor?: number
  customerCompanyId?: string
  supplierCompanyId?: string
  counterpartyCompanyId?: string
}>(
  rows: readonly T[],
  filters: {
    status?: string
    counterpartyCompanyId?: string
    fromDate?: string
    toDate?: string
    documentNumberContains?: string
    minOutstandingMinor?: number
    maxOutstandingMinor?: number
  },
): T[] {
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false
    const counterparty = row.customerCompanyId || row.supplierCompanyId || row.counterpartyCompanyId
    if (filters.counterpartyCompanyId && counterparty !== filters.counterpartyCompanyId) return false
    const date = row.issueDate || row.dueDate
    if (filters.fromDate && date && date < filters.fromDate) return false
    if (filters.toDate && date && date > filters.toDate) return false
    if (filters.documentNumberContains) {
      const needle = filters.documentNumberContains.toLowerCase()
      if (!(row.documentNumber || '').toLowerCase().includes(needle)) return false
    }
    if (typeof filters.minOutstandingMinor === 'number') {
      if ((row.outstandingMinor ?? 0) < filters.minOutstandingMinor) return false
    }
    if (typeof filters.maxOutstandingMinor === 'number') {
      if ((row.outstandingMinor ?? 0) > filters.maxOutstandingMinor) return false
    }
    return true
  })
}

// silence unused import when tree-shaken oddly
void assertSafeInteger
