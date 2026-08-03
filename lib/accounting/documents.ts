import {
  FinanceValidationError,
  assertMinorUnits,
  assertSafeInteger,
  immutableContentHash,
  parseCanonicalDate,
  requiredText,
} from './foundation'
import type {
  FinanceDocumentLine,
  FinanceDocumentStatus,
  OpenItemStatus,
  Reconciliation,
} from './documents-types'
import type { TaxAmountResult, TaxCode, TaxRuleVersion } from './tax-types'
import { calculateTaxAmount, resolveEffectiveTaxRule } from './tax'

export { FinanceValidationError }

export interface DocumentLineInput {
  id: string
  description: string
  quantityMilli: number
  unitPriceMinor: number
  taxCodeId: string
  taxIncluded: boolean
  revenueOrExpenseAccountId: string
  projectId?: string
  taskId?: string
  costCentreCode?: string
  branchId?: string
  companyId?: string
  contactId?: string
  employeeId?: string
}

export function assertPositiveMinor(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FinanceValidationError(`${field} must be a positive safe integer in minor units`)
  }
}

export function assertDueOnOrAfterIssue(issueDate: string, dueDate: string): void {
  const issue = parseCanonicalDate(issueDate, 'issueDate')
  const due = parseCanonicalDate(dueDate, 'dueDate')
  if (due < issue) throw new FinanceValidationError('dueDate must be on or after issueDate')
}

export function lineNetExclusiveMinor(quantityMilli: number, unitPriceMinor: number): number {
  assertSafeInteger(quantityMilli, 'quantityMilli', 1)
  assertMinorUnits(unitPriceMinor, 'unitPriceMinor')
  const product = quantityMilli * unitPriceMinor
  if (!Number.isSafeInteger(product)) {
    throw new FinanceValidationError('Line amount exceeds safe integer precision')
  }
  return Math.floor((product + 500) / 1000)
}

export function buildDocumentLine(input: {
  line: DocumentLineInput
  sequence: number
  taxCode: TaxCode
  taxRules: readonly TaxRuleVersion[]
  documentDate: string
}): FinanceDocumentLine {
  const { line, sequence, taxCode, taxRules, documentDate } = input
  requiredText(line.id, 'line.id')
  requiredText(line.description, 'line.description')
  requiredText(line.revenueOrExpenseAccountId, 'line.revenueOrExpenseAccountId')
  if (typeof line.taxIncluded !== 'boolean') throw new FinanceValidationError('line.taxIncluded must be boolean')
  if (taxCode.id !== line.taxCodeId) throw new FinanceValidationError('Line tax code does not match resolved tax code')
  const exclusiveBase = lineNetExclusiveMinor(line.quantityMilli, line.unitPriceMinor)
  const rule = resolveEffectiveTaxRule(taxRules, line.taxCodeId, documentDate)
  const calc: TaxAmountResult = calculateTaxAmount({
    taxCode,
    rule,
    taxableMinorExclusive: exclusiveBase,
    taxIncluded: line.taxIncluded,
    documentDate,
  })
  return {
    id: line.id,
    sequence,
    description: line.description.trim(),
    quantityMilli: line.quantityMilli,
    unitPriceMinor: line.unitPriceMinor,
    taxCodeId: line.taxCodeId,
    taxIncluded: line.taxIncluded,
    taxableMinor: calc.taxableMinor,
    taxMinor: calc.taxMinor,
    grossMinor: calc.grossMinor,
    revenueOrExpenseAccountId: line.revenueOrExpenseAccountId,
    taxTrace: calc.trace,
    ...(line.projectId ? { projectId: requiredText(line.projectId, 'line.projectId') } : {}),
    ...(line.taskId
      ? {
          taskId: requiredText(line.taskId, 'line.taskId'),
          projectId: requiredText(line.projectId || '', 'line.projectId'),
        }
      : {}),
    ...(line.costCentreCode ? { costCentreCode: requiredText(line.costCentreCode, 'line.costCentreCode') } : {}),
    ...(line.branchId ? { branchId: requiredText(line.branchId, 'line.branchId') } : {}),
    ...(line.companyId ? { companyId: requiredText(line.companyId, 'line.companyId') } : {}),
    ...(line.contactId ? { contactId: requiredText(line.contactId, 'line.contactId') } : {}),
    ...(line.employeeId ? { employeeId: requiredText(line.employeeId, 'line.employeeId') } : {}),
  }
}

export function sumDocumentLines(lines: readonly FinanceDocumentLine[]): {
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
} {
  if (lines.length === 0) throw new FinanceValidationError('Document requires at least one line')
  let subtotalMinor = 0
  let taxMinor = 0
  let totalMinor = 0
  for (const [index, line] of lines.entries()) {
    assertMinorUnits(line.taxableMinor, `lines[${index}].taxableMinor`)
    assertMinorUnits(line.taxMinor, `lines[${index}].taxMinor`)
    assertMinorUnits(line.grossMinor, `lines[${index}].grossMinor`)
    if (line.taxableMinor + line.taxMinor !== line.grossMinor) {
      throw new FinanceValidationError(`Line ${index + 1} tax components do not sum to gross`)
    }
    subtotalMinor += line.taxableMinor
    taxMinor += line.taxMinor
    totalMinor += line.grossMinor
    if (!Number.isSafeInteger(subtotalMinor) || !Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(totalMinor)) {
      throw new FinanceValidationError('Document totals exceed safe integer precision')
    }
  }
  if (subtotalMinor + taxMinor !== totalMinor) {
    throw new FinanceValidationError('Document tax components do not sum to total')
  }
  return { subtotalMinor, taxMinor, totalMinor }
}

export function projectOpenItemStatus(originalMinor: number, outstandingMinor: number): OpenItemStatus {
  assertMinorUnits(originalMinor, 'originalMinor')
  assertMinorUnits(outstandingMinor, 'outstandingMinor')
  if (outstandingMinor > originalMinor) {
    throw new FinanceValidationError('outstandingMinor cannot exceed originalMinor')
  }
  if (outstandingMinor === 0) return 'closed'
  if (outstandingMinor === originalMinor) return 'open'
  return 'partially_paid'
}

export function projectDocumentStatusFromOutstanding(
  current: FinanceDocumentStatus,
  originalMinor: number,
  outstandingMinor: number,
): FinanceDocumentStatus {
  if (current === 'voided' || current === 'written_off' || current === 'draft') return current
  const openStatus = projectOpenItemStatus(originalMinor, outstandingMinor)
  if (openStatus === 'closed') return 'paid'
  if (openStatus === 'partially_paid') return 'partially_paid'
  return 'issued'
}

export function assertAllocationAmount(
  paymentUnallocatedMinor: number,
  openItemOutstandingMinor: number,
  allocatedMinor: number,
  discountMinor = 0,
  writeOffMinor = 0,
): void {
  assertPositiveMinor(allocatedMinor, 'allocatedMinor')
  assertMinorUnits(discountMinor, 'discountMinor')
  assertMinorUnits(writeOffMinor, 'writeOffMinor')
  assertMinorUnits(paymentUnallocatedMinor, 'paymentUnallocatedMinor')
  assertMinorUnits(openItemOutstandingMinor, 'openItemOutstandingMinor')
  if (allocatedMinor > paymentUnallocatedMinor) {
    throw new FinanceValidationError('Allocation exceeds payment unallocated amount')
  }
  const reduction = allocatedMinor + discountMinor + writeOffMinor
  if (!Number.isSafeInteger(reduction)) {
    throw new FinanceValidationError('Allocation reduction exceeds safe integer precision')
  }
  if (reduction > openItemOutstandingMinor) {
    throw new FinanceValidationError('Allocation exceeds open item outstanding amount')
  }
}

export function formatDocumentNumber(prefix: string, sequence: number, width = 6): string {
  const cleanPrefix = requiredText(prefix, 'prefix').toUpperCase()
  assertSafeInteger(sequence, 'sequence', 1)
  assertSafeInteger(width, 'width', 1)
  return `${cleanPrefix}-${String(sequence).padStart(width, '0')}`
}

export function assertReconciliationStatementMath(input: {
  openingBalanceMinor: number
  closingBalanceMinor: number
  statementMovementMinor: number
}): void {
  if (!Number.isSafeInteger(input.openingBalanceMinor)) {
    throw new FinanceValidationError('openingBalanceMinor must be a safe integer')
  }
  if (!Number.isSafeInteger(input.closingBalanceMinor)) {
    throw new FinanceValidationError('closingBalanceMinor must be a safe integer')
  }
  if (!Number.isSafeInteger(input.statementMovementMinor)) {
    throw new FinanceValidationError('statementMovementMinor must be a safe integer')
  }
  if (input.openingBalanceMinor + input.statementMovementMinor !== input.closingBalanceMinor) {
    throw new FinanceValidationError('Statement closing balance must equal opening plus movements')
  }
}

export function computeReconciliationDifference(input: {
  statementMovementMinor: number
  matchedMovementMinor: number
}): number {
  if (!Number.isSafeInteger(input.statementMovementMinor) || !Number.isSafeInteger(input.matchedMovementMinor)) {
    throw new FinanceValidationError('Reconciliation movements must be safe integers')
  }
  const difference = input.statementMovementMinor - input.matchedMovementMinor
  if (!Number.isSafeInteger(difference)) {
    throw new FinanceValidationError('Reconciliation difference exceeds safe integer precision')
  }
  return difference
}

export function assertReconciliationCanApprove(recon: Pick<Reconciliation, 'differenceMinor' | 'status'>): void {
  if (recon.status !== 'in_review' && recon.status !== 'draft') {
    throw new FinanceValidationError('Only draft or in_review reconciliations can be approved')
  }
  if (recon.differenceMinor !== 0) {
    throw new FinanceValidationError('Approved reconciliation difference must be zero without an approved reconciling item')
  }
}

export function bankTransactionContentHash(value: object): string {
  return immutableContentHash(value)
}

export function paymentDirectionForTarget(
  targetType: 'customer_invoice' | 'supplier_bill' | 'open_item' | 'on_account',
  openItemRole?: 'customer' | 'supplier',
): 'receipt' | 'disbursement' | null {
  if (targetType === 'customer_invoice') return 'receipt'
  if (targetType === 'supplier_bill') return 'disbursement'
  if (targetType === 'open_item') {
    if (openItemRole === 'customer') return 'receipt'
    if (openItemRole === 'supplier') return 'disbursement'
  }
  return null
}
