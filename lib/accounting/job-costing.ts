import { canonicalDigest } from '@/lib/finance/integrity'
import type { AccountingBasis } from '@/lib/finance/types'
import {
  FinanceValidationError,
  assertMinorUnits,
  assertSafeInteger,
  parseCanonicalDate,
  requiredText,
} from './foundation'
import { hasProjectDimension, normalizeCostDimensions, type CostDimensions } from './cost-dimensions'
import { isIncomeExpenseRecognized } from './reporting'
import type {
  FinanceCustomerInvoice,
  FinanceDocumentLine,
  SupplierBill,
} from './documents-types'
import type { DocumentLineInput } from './documents'
import type {
  JobCostingScope,
  ProjectProfitAndLossReport,
  ProjectPnLSectionLine,
  ProjectWipReport,
  TimeCostApplication,
  TimeCostLineResult,
  TimeCostPurpose,
  TimeCostSourceEntry,
} from './job-costing-types'
import type { JournalLineInput, LedgerAccount, PostedJournalEntry } from './types'

export function laborCostMinor(durationMinutes: number, costRateMinorPerHour: number): number {
  assertSafeInteger(durationMinutes, 'durationMinutes', 1)
  assertMinorUnits(costRateMinorPerHour, 'costRateMinorPerHour')
  // Round half-up to nearest minor unit: minutes/60 * rate
  const product = durationMinutes * costRateMinorPerHour
  if (!Number.isSafeInteger(product)) {
    throw new FinanceValidationError('Labor cost exceeds safe integer precision')
  }
  return Math.floor((product + 30) / 60)
}

export function assertTimeEntryCostable(entry: TimeCostSourceEntry, purpose: TimeCostPurpose): void {
  requiredText(entry.timeEntryId, 'timeEntryId')
  requiredText(entry.orgId, 'orgId')
  requiredText(entry.projectId, 'projectId')
  requiredText(entry.currency, 'currency')
  if (entry.deleted) throw new FinanceValidationError(`Time entry ${entry.timeEntryId} is deleted`)
  if (!entry.endAt) throw new FinanceValidationError(`Time entry ${entry.timeEntryId} is still running`)
  if (!Number.isSafeInteger(entry.durationMinutes) || entry.durationMinutes <= 0) {
    throw new FinanceValidationError(`Time entry ${entry.timeEntryId} durationMinutes must be a positive integer`)
  }
  assertMinorUnits(entry.costRateMinorPerHour, 'costRateMinorPerHour')
  if (purpose === 'draft_invoice_lines') {
    if (!entry.billable) {
      throw new FinanceValidationError(`Time entry ${entry.timeEntryId} is not billable`)
    }
    if (entry.invoiceId) {
      throw new FinanceValidationError(
        `Time entry ${entry.timeEntryId} is already billed on invoice ${entry.invoiceId} — refusing double-billing`,
      )
    }
  }
}

export function buildTimeCostLines(
  entries: readonly TimeCostSourceEntry[],
  purpose: TimeCostPurpose,
  expectedOrgId: string,
): TimeCostLineResult[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new FinanceValidationError('At least one time entry is required')
  }
  const seen = new Set<string>()
  const lines: TimeCostLineResult[] = []
  for (const entry of entries) {
    assertTimeEntryCostable(entry, purpose)
    if (entry.orgId !== expectedOrgId) {
      throw new FinanceValidationError(`Time entry ${entry.timeEntryId} is outside org scope`)
    }
    if (seen.has(entry.timeEntryId)) {
      throw new FinanceValidationError(`Duplicate time entry ${entry.timeEntryId} in batch`)
    }
    seen.add(entry.timeEntryId)
    const amountMinor = laborCostMinor(entry.durationMinutes, entry.costRateMinorPerHour)
    if (amountMinor <= 0) {
      throw new FinanceValidationError(`Time entry ${entry.timeEntryId} produces zero cost`)
    }
    const dimensions = normalizeCostDimensions({
      projectId: entry.projectId,
      taskId: entry.taskId ?? undefined,
      employeeId: entry.userId,
    })
    lines.push({
      timeEntryId: entry.timeEntryId,
      projectId: entry.projectId,
      ...(dimensions.taskId ? { taskId: dimensions.taskId } : {}),
      durationMinutes: entry.durationMinutes,
      costRateMinorPerHour: entry.costRateMinorPerHour,
      amountMinor,
      currency: entry.currency.toUpperCase(),
      description: (entry.description || `Time ${entry.timeEntryId}`).trim(),
      dimensions,
    })
  }
  return lines
}

export function buildWipJournalLines(input: {
  lines: readonly TimeCostLineResult[]
  laborExpenseAccountId: string
  wipAssetAccountId: string
}): JournalLineInput[] {
  requiredText(input.laborExpenseAccountId, 'laborExpenseAccountId')
  requiredText(input.wipAssetAccountId, 'wipAssetAccountId')
  if (input.laborExpenseAccountId === input.wipAssetAccountId) {
    throw new FinanceValidationError('WIP asset and labor expense accounts must differ')
  }
  const total = input.lines.reduce((sum, line) => sum + line.amountMinor, 0)
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new FinanceValidationError('WIP journal total must be a positive safe integer')
  }
  // Debit expense (or COGS) by line for project dimension; credit WIP / accrued wages control as one balancing line.
  // Agency WIP pattern: Dr WIP asset, Cr labor clearing — then expense recognizes on bill.
  // Spec acceptance: time → finance line shows labor cost. Use Dr expense / Cr WIP clearing so project P&L sees cost immediately when posted.
  const expenseLines: JournalLineInput[] = input.lines.map((line) => ({
    accountId: input.laborExpenseAccountId,
    debitMinor: line.amountMinor,
    creditMinor: 0,
    description: line.description,
    ...line.dimensions,
  }))
  const credit: JournalLineInput = {
    accountId: input.wipAssetAccountId,
    debitMinor: 0,
    creditMinor: total,
    description: 'Time labor cost clearing',
    // no project on balancing control unless single-project batch
    ...(input.lines.length === 1 ? input.lines[0].dimensions : {}),
  }
  return [...expenseLines, credit]
}

export function buildDraftInvoiceLinesFromTime(input: {
  lines: readonly TimeCostLineResult[]
  revenueAccountId: string
  taxCodeId: string
}): DocumentLineInput[] {
  requiredText(input.revenueAccountId, 'revenueAccountId')
  requiredText(input.taxCodeId, 'taxCodeId')
  return input.lines.map((line, index) => ({
    id: `te_${line.timeEntryId}_${index + 1}`,
    description: line.description,
    quantityMilli: line.durationMinutes * 1000, // minutes as milli-hours? better: hours in milli
    // quantityMilli is thousandths of unit; unit = hour → minutes/60 * 1000 = minutes * 1000/60
    // Use hour units: quantityMilli = round(durationMinutes/60 * 1000)
    // Override properly below
    unitPriceMinor: line.costRateMinorPerHour,
    taxCodeId: input.taxCodeId,
    taxIncluded: false,
    revenueOrExpenseAccountId: input.revenueAccountId,
    ...line.dimensions,
  })).map((line, index) => {
    const source = input.lines[index]
    const quantityMilli = Math.floor((source.durationMinutes * 1000 + 30) / 60)
    return { ...line, quantityMilli }
  })
}

function inDateRange(date: string, fromDate: string, toDate: string): boolean {
  const epoch = parseCanonicalDate(date, 'postingDate')
  return epoch >= parseCanonicalDate(fromDate, 'fromDate') && epoch <= parseCanonicalDate(toDate, 'toDate')
}

function documentLineAmount(line: FinanceDocumentLine): number {
  return line.taxableMinor
}

export function buildProjectProfitAndLoss(input: {
  scope: JobCostingScope
  projectId: string
  fromDate: string
  toDate: string
  accountingBasis: AccountingBasis
  accounts: readonly LedgerAccount[]
  journals: readonly PostedJournalEntry[]
  invoices?: readonly FinanceCustomerInvoice[]
  bills?: readonly SupplierBill[]
}): ProjectProfitAndLossReport {
  const projectId = requiredText(input.projectId, 'projectId')
  parseCanonicalDate(input.fromDate, 'fromDate')
  parseCanonicalDate(input.toDate, 'toDate')
  const accountsById = new Map(input.accounts.map((a) => [a.id, a]))
  const revenueMap = new Map<string, ProjectPnLSectionLine>()
  const costMap = new Map<string, ProjectPnLSectionLine>()
  const journalEntryIds: string[] = []
  const invoiceIds: string[] = []
  const billIds: string[] = []

  const bump = (
    map: Map<string, ProjectPnLSectionLine>,
    account: LedgerAccount,
    amountMinor: number,
    source: 'journal' | 'document',
  ) => {
    if (amountMinor === 0) return
    const key = `${source}:${account.id}`
    const current = map.get(key) ?? {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.accountType as 'income' | 'expense',
      amountMinor: 0,
      source,
    }
    current.amountMinor += amountMinor
    if (!Number.isSafeInteger(current.amountMinor)) {
      throw new FinanceValidationError('Project P&L amount exceeded safe integer precision')
    }
    map.set(key, current)
  }

  for (const journal of input.journals) {
    if (journal.status !== 'posted') continue
    if (
      journal.orgId !== input.scope.orgId ||
      journal.legalEntityId !== input.scope.legalEntityId ||
      journal.bookId !== input.scope.bookId
    ) {
      throw new FinanceValidationError('Journal is outside job-costing scope')
    }
    if (!inDateRange(journal.postingDate, input.fromDate, input.toDate)) continue
    if (!isIncomeExpenseRecognized(input.accountingBasis, journal.postingPurpose)) continue
    let included = false
    for (const line of journal.lines) {
      if (!hasProjectDimension(line, projectId)) continue
      const account = accountsById.get(line.accountId)
      if (!account) throw new FinanceValidationError(`Report account ${line.accountId} was not loaded`)
      if (account.accountType !== 'income' && account.accountType !== 'expense') continue
      const raw = line.debitMinor - line.creditMinor
      const amountMinor = account.normalBalance === 'debit' ? raw : -raw
      if (account.accountType === 'income') bump(revenueMap, account, amountMinor, 'journal')
      else bump(costMap, account, amountMinor, 'journal')
      included = true
    }
    if (included) journalEntryIds.push(journal.id)
  }

  for (const invoice of input.invoices ?? []) {
    if (
      invoice.orgId !== input.scope.orgId ||
      invoice.legalEntityId !== input.scope.legalEntityId ||
      invoice.bookId !== input.scope.bookId
    ) {
      throw new FinanceValidationError('Invoice is outside job-costing scope')
    }
    if (invoice.status === 'voided' || invoice.status === 'draft') continue
    if (!inDateRange(invoice.issueDate, input.fromDate, input.toDate)) continue
    let included = false
    for (const line of invoice.lines) {
      if (!hasProjectDimension(line, projectId)) continue
      const account = accountsById.get(line.revenueOrExpenseAccountId)
      if (!account || account.accountType !== 'income') continue
      bump(revenueMap, account, documentLineAmount(line), 'document')
      included = true
    }
    if (included) invoiceIds.push(invoice.id)
  }

  for (const bill of input.bills ?? []) {
    if (
      bill.orgId !== input.scope.orgId ||
      bill.legalEntityId !== input.scope.legalEntityId ||
      bill.bookId !== input.scope.bookId
    ) {
      throw new FinanceValidationError('Bill is outside job-costing scope')
    }
    if (bill.status === 'voided' || bill.status === 'draft') continue
    if (!inDateRange(bill.issueDate, input.fromDate, input.toDate)) continue
    let included = false
    for (const line of bill.lines) {
      if (!hasProjectDimension(line, projectId)) continue
      const account = accountsById.get(line.revenueOrExpenseAccountId)
      if (!account || account.accountType !== 'expense') continue
      bump(costMap, account, documentLineAmount(line), 'document')
      included = true
    }
    if (included) billIds.push(bill.id)
  }

  const revenueLines = [...revenueMap.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  const costLines = [...costMap.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  const totalRevenueMinor = revenueLines.reduce((s, l) => s + l.amountMinor, 0)
  const totalCostMinor = costLines.reduce((s, l) => s + l.amountMinor, 0)
  journalEntryIds.sort()
  invoiceIds.sort()
  billIds.sort()
  const meta = {
    orgId: input.scope.orgId,
    legalEntityId: input.scope.legalEntityId,
    bookId: input.scope.bookId,
    projectId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    accountingBasis: input.accountingBasis,
    journalEntryIds,
    invoiceIds,
    billIds,
    totalRevenueMinor,
    totalCostMinor,
  }
  return {
    kind: 'project_profit_and_loss',
    scope: input.scope,
    projectId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    accountingBasis: input.accountingBasis,
    revenueLines,
    costLines,
    totalRevenueMinor,
    totalCostMinor,
    grossMarginMinor: totalRevenueMinor - totalCostMinor,
    journalEntryIds,
    invoiceIds,
    billIds,
    inputDigest: canonicalDigest(meta),
  }
}

export function buildProjectWip(input: {
  scope: JobCostingScope
  projectId: string
  asOfDate: string
  applications: readonly TimeCostApplication[]
  pnl: Pick<ProjectProfitAndLossReport, 'totalRevenueMinor' | 'totalCostMinor'>
}): ProjectWipReport {
  const projectId = requiredText(input.projectId, 'projectId')
  parseCanonicalDate(input.asOfDate, 'asOfDate')
  const openIds: string[] = []
  let unbilledLaborCostMinor = 0
  for (const app of input.applications) {
    if (app.status !== 'applied') continue
    if (app.purpose !== 'wip_cost') continue
    if (
      app.orgId !== input.scope.orgId ||
      app.legalEntityId !== input.scope.legalEntityId ||
      app.bookId !== input.scope.bookId
    ) {
      continue
    }
    if (app.createdAt.slice(0, 10) > input.asOfDate) continue
    const projectLines = app.lines.filter((line) => line.projectId === projectId)
    if (projectLines.length === 0) continue
    const amount = projectLines.reduce((s, l) => s + l.amountMinor, 0)
    unbilledLaborCostMinor += amount
    openIds.push(app.id)
  }
  if (!Number.isSafeInteger(unbilledLaborCostMinor)) {
    throw new FinanceValidationError('WIP total exceeded safe integer precision')
  }
  openIds.sort()
  const meta = {
    orgId: input.scope.orgId,
    legalEntityId: input.scope.legalEntityId,
    bookId: input.scope.bookId,
    projectId,
    asOfDate: input.asOfDate,
    unbilledLaborCostMinor,
    recognizedRevenueMinor: input.pnl.totalRevenueMinor,
    recognizedCostMinor: input.pnl.totalCostMinor,
    openTimeCostApplicationIds: openIds,
  }
  return {
    kind: 'project_wip',
    scope: input.scope,
    projectId,
    asOfDate: input.asOfDate,
    unbilledLaborCostMinor,
    recognizedRevenueMinor: input.pnl.totalRevenueMinor,
    recognizedCostMinor: input.pnl.totalCostMinor,
    wipMinor: unbilledLaborCostMinor,
    openTimeCostApplicationIds: openIds,
    inputDigest: canonicalDigest(meta),
  }
}

export function timeEntryClaimKey(purpose: TimeCostPurpose, timeEntryId: string): string {
  return `time_cost:${purpose}:${timeEntryId}`
}

export type { CostDimensions }
