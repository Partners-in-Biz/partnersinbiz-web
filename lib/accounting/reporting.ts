import { canonicalDigest } from '@/lib/finance/integrity'
import type { AccountingBasis, FinanceScope } from '@/lib/finance/types'
import { FinanceValidationError, parseCanonicalDate, requiredText } from './foundation'
import type {
  AccountingPeriod,
  JournalLine,
  LedgerAccount,
  LedgerAccountType,
  PostedJournalEntry,
} from './types'

export interface ReportScope extends Required<FinanceScope> {}

export interface ReportInputMeta {
  orgId: string
  legalEntityId: string
  bookId: string
  accountingBasis: AccountingBasis
  asOfDate?: string
  fromDate?: string
  toDate?: string
  journalEntryIds: string[]
  accountIds: string[]
  periodStatus?: AccountingPeriod['status']
}

export interface TrialBalanceLine {
  accountId: string
  accountCode: string
  accountName: string
  accountType: LedgerAccountType
  reportMapping: string
  debitMinor: number
  creditMinor: number
  netDebitMinor: number
}

export interface TrialBalanceReport {
  kind: 'trial_balance'
  scope: ReportScope
  asOfDate: string
  accountingBasis: AccountingBasis
  periodStatus?: AccountingPeriod['status']
  lines: TrialBalanceLine[]
  totalDebitMinor: number
  totalCreditMinor: number
  balanced: boolean
  input: ReportInputMeta
  inputDigest: string
}

export interface IncomeStatementSectionLine {
  accountId: string
  accountCode: string
  accountName: string
  reportMapping: string
  amountMinor: number
}

export interface IncomeStatementReport {
  kind: 'income_statement'
  scope: ReportScope
  fromDate: string
  toDate: string
  accountingBasis: AccountingBasis
  incomeLines: IncomeStatementSectionLine[]
  expenseLines: IncomeStatementSectionLine[]
  totalIncomeMinor: number
  totalExpenseMinor: number
  netIncomeMinor: number
  input: ReportInputMeta
  inputDigest: string
}

export interface BalanceSheetSectionLine {
  accountId: string
  accountCode: string
  accountName: string
  reportMapping: string
  amountMinor: number
}

export interface BalanceSheetReport {
  kind: 'balance_sheet'
  scope: ReportScope
  asOfDate: string
  accountingBasis: AccountingBasis
  assets: BalanceSheetSectionLine[]
  liabilities: BalanceSheetSectionLine[]
  equity: BalanceSheetSectionLine[]
  totalAssetsMinor: number
  totalLiabilitiesMinor: number
  totalEquityMinor: number
  periodNetIncomeMinor: number
  balanced: boolean
  input: ReportInputMeta
  inputDigest: string
}

interface AccountBalance {
  debitMinor: number
  creditMinor: number
}

const MEMORANDUM_PURPOSES = new Set([
  'memorandum',
  'commitment',
  'memorandum_only',
])

/**
 * Whether income/expense movements from a posting purpose are recognized on P&L
 * for the requested bookkeeping basis. Trial balance always includes all postings.
 */
export function isIncomeExpenseRecognized(basis: AccountingBasis, postingPurpose: string): boolean {
  const purpose = requiredText(postingPurpose, 'postingPurpose')
  if (MEMORANDUM_PURPOSES.has(purpose)) return false
  if (basis === 'accrual') {
    // Accrual recognizes at document issue (and opening/adjustment); settlement is BS only.
    if (purpose === 'verified_allocation' || purpose === 'settlement' || purpose === 'cash_receipt' || purpose === 'cash_payment') {
      return false
    }
    return true
  }
  // Cash basis: only cash recognition events hit P&L.
  return purpose === 'verified_allocation' ||
    purpose === 'cash_receipt' ||
    purpose === 'cash_payment' ||
    purpose === 'opening_balance' ||
    purpose === 'cash_recognition'
}

function assertScope(scope: ReportScope, journal: PostedJournalEntry): void {
  if (journal.orgId !== scope.orgId || journal.legalEntityId !== scope.legalEntityId || journal.bookId !== scope.bookId) {
    throw new FinanceValidationError('Journal is outside report scope')
  }
}

function inDateRange(date: string, fromDate?: string, toDate?: string, asOfDate?: string): boolean {
  const epoch = parseCanonicalDate(date, 'postingDate')
  if (asOfDate !== undefined) {
    return epoch <= parseCanonicalDate(asOfDate, 'asOfDate')
  }
  if (fromDate !== undefined && epoch < parseCanonicalDate(fromDate, 'fromDate')) return false
  if (toDate !== undefined && epoch > parseCanonicalDate(toDate, 'toDate')) return false
  return true
}

function accumulateBalances(
  scope: ReportScope,
  journals: readonly PostedJournalEntry[],
  options: {
    asOfDate?: string
    fromDate?: string
    toDate?: string
    lineFilter?: (journal: PostedJournalEntry, line: JournalLine, account: LedgerAccount) => boolean
    accountsById: Map<string, LedgerAccount>
  },
): { balances: Map<string, AccountBalance>; journalEntryIds: string[] } {
  const balances = new Map<string, AccountBalance>()
  const journalEntryIds: string[] = []
  for (const journal of journals) {
    if (journal.status !== 'posted') continue
    assertScope(scope, journal)
    if (!inDateRange(journal.postingDate, options.fromDate, options.toDate, options.asOfDate)) continue
    let included = false
    for (const line of journal.lines) {
      const account = options.accountsById.get(line.accountId)
      if (!account) throw new FinanceValidationError(`Report account ${line.accountId} was not loaded`)
      if (account.orgId !== scope.orgId || account.legalEntityId !== scope.legalEntityId || account.bookId !== scope.bookId) {
        throw new FinanceValidationError(`Report account ${line.accountId} is outside scope`)
      }
      if (options.lineFilter && !options.lineFilter(journal, line, account)) continue
      const current = balances.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 }
      current.debitMinor += line.debitMinor
      current.creditMinor += line.creditMinor
      if (!Number.isSafeInteger(current.debitMinor) || !Number.isSafeInteger(current.creditMinor)) {
        throw new FinanceValidationError('Report balance exceeded safe integer precision')
      }
      balances.set(line.accountId, current)
      included = true
    }
    if (included) journalEntryIds.push(journal.id)
  }
  journalEntryIds.sort()
  return { balances, journalEntryIds }
}

function signedNet(account: LedgerAccount, balance: AccountBalance): number {
  const raw = balance.debitMinor - balance.creditMinor
  return account.normalBalance === 'debit' ? raw : -raw
}

function digestInput(input: ReportInputMeta): string {
  return canonicalDigest(input)
}

export function buildTrialBalance(input: {
  scope: ReportScope
  accounts: readonly LedgerAccount[]
  journals: readonly PostedJournalEntry[]
  asOfDate: string
  accountingBasis: AccountingBasis
  periodStatus?: AccountingPeriod['status']
}): TrialBalanceReport {
  parseCanonicalDate(input.asOfDate, 'asOfDate')
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]))
  const { balances, journalEntryIds } = accumulateBalances(input.scope, input.journals, {
    asOfDate: input.asOfDate,
    accountsById,
  })

  const lines: TrialBalanceLine[] = [...balances.entries()]
    .map(([accountId, balance]) => {
      const account = accountsById.get(accountId)!
      const net = balance.debitMinor - balance.creditMinor
      return {
        accountId,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.accountType,
        reportMapping: account.reportMapping,
        debitMinor: net > 0 ? net : 0,
        creditMinor: net < 0 ? -net : 0,
        netDebitMinor: net,
      }
    })
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode))

  const totalDebitMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0)
  const totalCreditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0)
  const meta: ReportInputMeta = {
    orgId: input.scope.orgId,
    legalEntityId: input.scope.legalEntityId,
    bookId: input.scope.bookId,
    accountingBasis: input.accountingBasis,
    asOfDate: input.asOfDate,
    journalEntryIds,
    accountIds: lines.map((line) => line.accountId).sort(),
    periodStatus: input.periodStatus,
  }

  return {
    kind: 'trial_balance',
    scope: input.scope,
    asOfDate: input.asOfDate,
    accountingBasis: input.accountingBasis,
    periodStatus: input.periodStatus,
    lines,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
    input: meta,
    inputDigest: digestInput(meta),
  }
}

export function buildIncomeStatement(input: {
  scope: ReportScope
  accounts: readonly LedgerAccount[]
  journals: readonly PostedJournalEntry[]
  fromDate: string
  toDate: string
  accountingBasis: AccountingBasis
}): IncomeStatementReport {
  parseCanonicalDate(input.fromDate, 'fromDate')
  parseCanonicalDate(input.toDate, 'toDate')
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]))
  const { balances, journalEntryIds } = accumulateBalances(input.scope, input.journals, {
    fromDate: input.fromDate,
    toDate: input.toDate,
    accountsById,
    lineFilter: (journal, _line, account) => {
      if (account.accountType !== 'income' && account.accountType !== 'expense') return false
      return isIncomeExpenseRecognized(input.accountingBasis, journal.postingPurpose)
    },
  })

  const incomeLines: IncomeStatementSectionLine[] = []
  const expenseLines: IncomeStatementSectionLine[] = []
  for (const [accountId, balance] of balances.entries()) {
    const account = accountsById.get(accountId)!
    const amountMinor = signedNet(account, balance)
    const row = {
      accountId,
      accountCode: account.code,
      accountName: account.name,
      reportMapping: account.reportMapping,
      amountMinor,
    }
    if (account.accountType === 'income') incomeLines.push(row)
    else expenseLines.push(row)
  }
  incomeLines.sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  expenseLines.sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  const totalIncomeMinor = incomeLines.reduce((sum, line) => sum + line.amountMinor, 0)
  const totalExpenseMinor = expenseLines.reduce((sum, line) => sum + line.amountMinor, 0)
  const meta: ReportInputMeta = {
    orgId: input.scope.orgId,
    legalEntityId: input.scope.legalEntityId,
    bookId: input.scope.bookId,
    accountingBasis: input.accountingBasis,
    fromDate: input.fromDate,
    toDate: input.toDate,
    journalEntryIds,
    accountIds: [...incomeLines, ...expenseLines].map((line) => line.accountId).sort(),
  }

  return {
    kind: 'income_statement',
    scope: input.scope,
    fromDate: input.fromDate,
    toDate: input.toDate,
    accountingBasis: input.accountingBasis,
    incomeLines,
    expenseLines,
    totalIncomeMinor,
    totalExpenseMinor,
    netIncomeMinor: totalIncomeMinor - totalExpenseMinor,
    input: meta,
    inputDigest: digestInput(meta),
  }
}

export function buildBalanceSheet(input: {
  scope: ReportScope
  accounts: readonly LedgerAccount[]
  journals: readonly PostedJournalEntry[]
  asOfDate: string
  accountingBasis: AccountingBasis
  retainedEarningsAccountId?: string
}): BalanceSheetReport {
  parseCanonicalDate(input.asOfDate, 'asOfDate')
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]))
  const { balances, journalEntryIds } = accumulateBalances(input.scope, input.journals, {
    asOfDate: input.asOfDate,
    accountsById,
  })

  // Net income for BS roll-forward uses basis-aware income statement through as-of date.
  const income = buildIncomeStatement({
    scope: input.scope,
    accounts: input.accounts,
    journals: input.journals,
    fromDate: '1970-01-01',
    toDate: input.asOfDate,
    accountingBasis: input.accountingBasis,
  })

  const assets: BalanceSheetSectionLine[] = []
  const liabilities: BalanceSheetSectionLine[] = []
  const equity: BalanceSheetSectionLine[] = []

  for (const account of input.accounts) {
    if (account.accountType === 'income' || account.accountType === 'expense') continue
    const balance = balances.get(account.id) ?? { debitMinor: 0, creditMinor: 0 }
    let amountMinor = signedNet(account, balance)
    if (input.retainedEarningsAccountId && account.id === input.retainedEarningsAccountId) {
      amountMinor += income.netIncomeMinor
    }
    if (amountMinor === 0 && !balances.has(account.id) && account.id !== input.retainedEarningsAccountId) continue
    const row = {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      reportMapping: account.reportMapping,
      amountMinor,
    }
    if (account.accountType === 'asset') assets.push(row)
    else if (account.accountType === 'liability') liabilities.push(row)
    else equity.push(row)
  }

  // If retained earnings account was not listed but net income exists, surface synthetic equity line.
  if (income.netIncomeMinor !== 0) {
    const retainedId = input.retainedEarningsAccountId
    const already = retainedId ? equity.some((line) => line.accountId === retainedId) : false
    if (!already) {
      equity.push({
        accountId: retainedId ?? 'synthetic_period_net_income',
        accountCode: retainedId ? (accountsById.get(retainedId)?.code ?? 'RE') : 'RE',
        accountName: retainedId ? (accountsById.get(retainedId)?.name ?? 'Retained earnings') : 'Period net income',
        reportMapping: retainedId ? (accountsById.get(retainedId)?.reportMapping ?? 'equity.retained_earnings') : 'equity.retained_earnings',
        amountMinor: income.netIncomeMinor,
      })
    }
  }

  assets.sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  liabilities.sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  equity.sort((a, b) => a.accountCode.localeCompare(b.accountCode))

  const totalAssetsMinor = assets.reduce((sum, line) => sum + line.amountMinor, 0)
  const totalLiabilitiesMinor = liabilities.reduce((sum, line) => sum + line.amountMinor, 0)
  const totalEquityMinor = equity.reduce((sum, line) => sum + line.amountMinor, 0)
  const meta: ReportInputMeta = {
    orgId: input.scope.orgId,
    legalEntityId: input.scope.legalEntityId,
    bookId: input.scope.bookId,
    accountingBasis: input.accountingBasis,
    asOfDate: input.asOfDate,
    journalEntryIds,
    accountIds: [...assets, ...liabilities, ...equity].map((line) => line.accountId).sort(),
  }

  return {
    kind: 'balance_sheet',
    scope: input.scope,
    asOfDate: input.asOfDate,
    accountingBasis: input.accountingBasis,
    assets,
    liabilities,
    equity,
    totalAssetsMinor,
    totalLiabilitiesMinor,
    totalEquityMinor,
    periodNetIncomeMinor: income.netIncomeMinor,
    balanced: totalAssetsMinor === totalLiabilitiesMinor + totalEquityMinor,
    input: meta,
    inputDigest: digestInput(meta),
  }
}
