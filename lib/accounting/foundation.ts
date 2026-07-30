import type { AccountingBasis, FinanceScope } from '@/lib/finance/types'
import type { AccountingPeriod, JournalLineInput } from './types'

export class FinanceValidationError extends Error {
  readonly statusCode = 422

  constructor(message: string) {
    super(message)
    this.name = 'FinanceValidationError'
  }
}

export function requiredText(value: string, field: string): string {
  const clean = value.trim()
  if (!clean) throw new FinanceValidationError(`${field} is required`)
  return clean
}

export function assertMinorUnits(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative safe integer in minor units`)
  }
}

export function assertBalancedJournal(lines: readonly JournalLineInput[]): { debitMinor: number; creditMinor: number } {
  if (lines.length < 2) throw new FinanceValidationError('A posted journal requires at least two lines')
  let debitMinor = 0
  let creditMinor = 0
  for (const [index, line] of lines.entries()) {
    requiredText(line.accountId, `lines[${index}].accountId`)
    assertMinorUnits(line.debitMinor, `lines[${index}].debitMinor`)
    assertMinorUnits(line.creditMinor, `lines[${index}].creditMinor`)
    const hasDebit = line.debitMinor > 0
    const hasCredit = line.creditMinor > 0
    if (hasDebit === hasCredit) {
      throw new FinanceValidationError(`Line ${index + 1} must contain exactly one positive debit or credit`)
    }
    debitMinor += line.debitMinor
    creditMinor += line.creditMinor
    if (!Number.isSafeInteger(debitMinor) || !Number.isSafeInteger(creditMinor)) {
      throw new FinanceValidationError('Journal totals exceed safe integer precision')
    }
  }
  if (debitMinor !== creditMinor) throw new FinanceValidationError('Journal is not balanced')
  return { debitMinor, creditMinor }
}

export function assertJournalScope(
  scope: FinanceScope,
  lines: readonly (JournalLineInput & FinanceScope & { periodId: string })[],
): void {
  for (const line of lines) {
    if (
      line.orgId !== scope.orgId ||
      line.legalEntityId !== scope.legalEntityId ||
      line.bookId !== scope.bookId
    ) {
      throw new FinanceValidationError('Journal line scope does not match entry scope')
    }
  }
}

export function assertPeriodAllowsPosting(
  period: AccountingPeriod,
  postingDate: string,
  authorizedAdjustment: boolean,
): void {
  if (postingDate < period.startsAt || postingDate > period.endsAt) {
    throw new FinanceValidationError('Posting date is outside the accounting period')
  }
  if (period.status === 'hard_closed') throw new FinanceValidationError('Accounting period is hard closed')
  if (period.status === 'soft_closed' && !authorizedAdjustment) {
    throw new FinanceValidationError('Accounting period is soft closed and requires an authorized adjustment')
  }
}

export type RecognitionEvent = 'document_issued' | 'verified_allocation'
export type RecognitionTiming = 'recognize' | 'memorandum_only' | 'settle_control_account'

export function resolveRecognitionTiming(basis: AccountingBasis, event: RecognitionEvent): RecognitionTiming {
  if (event === 'document_issued') return basis === 'accrual' ? 'recognize' : 'memorandum_only'
  return basis === 'cash' ? 'recognize' : 'settle_control_account'
}

export function buildReversalLines(lines: readonly JournalLineInput[]): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor,
    description: line.description ? `Reversal: ${line.description}` : 'Reversal',
  }))
}
