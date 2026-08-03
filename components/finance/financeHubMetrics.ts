import { formatMinor } from '@/components/finance/financeWorkbench'

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export type AgingBucket = {
  key: AgingBucketKey
  label: string
  amountMinor: number
  count: number
}

export type OpenItemLike = {
  outstandingMinor?: number
  dueDate?: string
  status?: string
  counterpartyRole?: string
  sourceType?: string
  currency?: string
}

export type BankAccountLike = {
  currentBalanceMinor?: number
  ledgerBalanceMinor?: number
  balanceMinor?: number
  currency?: string
  status?: string
}

export type PeriodLike = {
  status?: string
  fiscalYear?: number
  periodNumber?: number
}

export type PayRunLike = {
  status?: string
}

export type TaxReturnLike = {
  status?: string
}

export type PackagingPackLike = {
  status?: string
  family?: string
}

export type FinanceHubSnapshotInput = {
  openItems?: OpenItemLike[]
  bankAccounts?: BankAccountLike[]
  periods?: PeriodLike[]
  payRuns?: PayRunLike[]
  taxReturns?: TaxReturnLike[]
  packagingPacks?: PackagingPackLike[]
  currency?: string
  asOfDate?: string
}

export type FinanceHubSnapshot = {
  currency: string
  cashMinor: number
  cashAccountCount: number
  arOutstandingMinor: number
  apOutstandingMinor: number
  arAging: AgingBucket[]
  apAging: AgingBucket[]
  openPeriodCount: number
  periodCount: number
  payrollRunsInReview: number
  payrollRunsLocked: number
  taxReturnsReady: number
  taxReturnsDraft: number
  packagingReady: number
  packagingTotal: number
}

const EMPTY_AGING = (): AgingBucket[] => [
  { key: 'current', label: 'Current', amountMinor: 0, count: 0 },
  { key: 'd1_30', label: '1–30', amountMinor: 0, count: 0 },
  { key: 'd31_60', label: '31–60', amountMinor: 0, count: 0 },
  { key: 'd61_90', label: '61–90', amountMinor: 0, count: 0 },
  { key: 'd90_plus', label: '90+', amountMinor: 0, count: 0 },
]

function parseDateOnly(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback
  const normalized = value.slice(0, 10)
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function daysPastDue(dueDate: string | undefined, asOf: Date): number {
  const due = parseDateOnly(dueDate, asOf)
  const ms = asOf.getTime() - due.getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

function bucketForDays(days: number): AgingBucketKey {
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90_plus'
}

function isOpenItemActive(item: OpenItemLike): boolean {
  const status = String(item.status || '').toLowerCase()
  if (status === 'closed' || status === 'voided' || status === 'paid') return false
  const outstanding = typeof item.outstandingMinor === 'number' ? item.outstandingMinor : 0
  return outstanding > 0
}

function isReceivable(item: OpenItemLike): boolean {
  if (item.counterpartyRole === 'customer') return true
  if (item.counterpartyRole === 'supplier') return false
  if (item.sourceType === 'customer_invoice') return true
  if (item.sourceType === 'supplier_bill') return false
  return item.counterpartyRole !== 'supplier'
}

export function buildAgingBuckets(
  items: OpenItemLike[],
  role: 'customer' | 'supplier',
  asOfDate?: string,
): AgingBucket[] {
  const asOf = parseDateOnly(asOfDate, new Date())
  const buckets = EMPTY_AGING()
  const index = new Map(buckets.map((bucket) => [bucket.key, bucket]))

  for (const item of items) {
    if (!isOpenItemActive(item)) continue
    const receivable = isReceivable(item)
    if (role === 'customer' && !receivable) continue
    if (role === 'supplier' && receivable) continue
    const amount = typeof item.outstandingMinor === 'number' ? item.outstandingMinor : 0
    if (amount <= 0) continue
    const key = bucketForDays(daysPastDue(item.dueDate, asOf))
    const bucket = index.get(key)
    if (!bucket) continue
    bucket.amountMinor += amount
    bucket.count += 1
  }

  return buckets
}

export function sumAging(buckets: AgingBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.amountMinor, 0)
}

export function sumCashBalance(accounts: BankAccountLike[]): { cashMinor: number; count: number } {
  let cashMinor = 0
  let count = 0
  for (const account of accounts) {
    const status = String(account.status || 'active').toLowerCase()
    if (status === 'closed' || status === 'archived') continue
    const balance =
      typeof account.currentBalanceMinor === 'number'
        ? account.currentBalanceMinor
        : typeof account.ledgerBalanceMinor === 'number'
          ? account.ledgerBalanceMinor
          : typeof account.balanceMinor === 'number'
            ? account.balanceMinor
            : 0
    cashMinor += balance
    count += 1
  }
  return { cashMinor, count }
}

export function buildFinanceHubSnapshot(input: FinanceHubSnapshotInput): FinanceHubSnapshot {
  const currency = input.currency || 'ZAR'
  const openItems = input.openItems || []
  const arAging = buildAgingBuckets(openItems, 'customer', input.asOfDate)
  const apAging = buildAgingBuckets(openItems, 'supplier', input.asOfDate)
  const cash = sumCashBalance(input.bankAccounts || [])
  const periods = input.periods || []
  const payRuns = input.payRuns || []
  const taxReturns = input.taxReturns || []
  const packs = input.packagingPacks || []

  const payrollRunsInReview = payRuns.filter((run) => {
    const status = String(run.status || '').toLowerCase()
    return status === 'in_review' || status === 'calculated' || status === 'draft'
  }).length
  const payrollRunsLocked = payRuns.filter((run) => {
    const status = String(run.status || '').toLowerCase()
    return status === 'approved_locked' || status === 'locked' || status === 'approved'
  }).length

  const taxReturnsReady = taxReturns.filter((row) => {
    const status = String(row.status || '').toLowerCase()
    return status === 'prepared' || status === 'approved' || status === 'ready'
  }).length
  const taxReturnsDraft = taxReturns.filter((row) => {
    const status = String(row.status || '').toLowerCase()
    return status === 'draft' || status === 'open' || status === 'calculating'
  }).length

  const packagingReady = packs.filter((pack) => {
    const status = String(pack.status || '').toLowerCase()
    return status === 'ready' || status === 'downloaded' || status === 'created'
  }).length

  return {
    currency,
    cashMinor: cash.cashMinor,
    cashAccountCount: cash.count,
    arOutstandingMinor: sumAging(arAging),
    apOutstandingMinor: sumAging(apAging),
    arAging,
    apAging,
    openPeriodCount: periods.filter((period) => String(period.status || '').toLowerCase() === 'open').length,
    periodCount: periods.length,
    payrollRunsInReview,
    payrollRunsLocked,
    taxReturnsReady,
    taxReturnsDraft,
    packagingReady,
    packagingTotal: packs.length,
  }
}

export function formatHubMoney(amountMinor: number, currency = 'ZAR') {
  return formatMinor(amountMinor, currency)
}
