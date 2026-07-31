import {
  FinanceValidationError,
  assertMinorUnits,
  assertSafeInteger,
  requiredText,
} from './foundation'
import type { JournalLineInput } from './types'
import type {
  ConsolidatedReportingBoundary,
  DueToDueFromBalance,
  IntercompanyTransactionStatus,
} from './intercompany-types'

export { FinanceValidationError }

export function normalizeIntercompanyPairKey(
  sourceLegalEntityId: string,
  sourceBookId: string,
  receivingLegalEntityId: string,
  receivingBookId: string,
): string {
  const left = `${requiredText(sourceLegalEntityId, 'sourceLegalEntityId')}|${requiredText(sourceBookId, 'sourceBookId')}`
  const right = `${requiredText(receivingLegalEntityId, 'receivingLegalEntityId')}|${requiredText(receivingBookId, 'receivingBookId')}`
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

export function assertDistinctLegalEntities(sourceLegalEntityId: string, receivingLegalEntityId: string): void {
  const source = requiredText(sourceLegalEntityId, 'sourceLegalEntityId')
  const receiving = requiredText(receivingLegalEntityId, 'receivingLegalEntityId')
  if (source === receiving) {
    throw new FinanceValidationError('Intercompany legal entities must differ')
  }
}

export function assertPairedAmountsReconcile(
  sourceAmountMinor: number,
  receivingAmountMinor: number,
  sourceCurrency: string,
  receivingCurrency: string,
): void {
  assertSafeInteger(sourceAmountMinor, 'sourceAmountMinor', 1)
  assertSafeInteger(receivingAmountMinor, 'receivingAmountMinor', 1)
  const sourceCurrencyClean = requiredText(sourceCurrency, 'sourceCurrency').toUpperCase()
  const receivingCurrencyClean = requiredText(receivingCurrency, 'receivingCurrency').toUpperCase()
  if (sourceCurrencyClean !== receivingCurrencyClean) {
    throw new FinanceValidationError('Paired amounts must share the same transaction currency')
  }
  if (sourceAmountMinor !== receivingAmountMinor) {
    throw new FinanceValidationError('Paired amounts do not reconcile in transaction currency')
  }
}

export function buildChargeSourceLines(input: {
  amountMinor: number
  dueFromAccountId: string
  revenueAccountId: string
  description: string
}): JournalLineInput[] {
  assertSafeInteger(input.amountMinor, 'amountMinor', 1)
  const description = requiredText(input.description, 'description')
  return [
    {
      accountId: requiredText(input.dueFromAccountId, 'dueFromAccountId'),
      debitMinor: input.amountMinor,
      creditMinor: 0,
      description,
    },
    {
      accountId: requiredText(input.revenueAccountId, 'revenueAccountId'),
      debitMinor: 0,
      creditMinor: input.amountMinor,
      description,
    },
  ]
}

export function buildChargeReceivingLines(input: {
  amountMinor: number
  dueToAccountId: string
  expenseAccountId: string
  description: string
}): JournalLineInput[] {
  assertSafeInteger(input.amountMinor, 'amountMinor', 1)
  const description = requiredText(input.description, 'description')
  return [
    {
      accountId: requiredText(input.expenseAccountId, 'expenseAccountId'),
      debitMinor: input.amountMinor,
      creditMinor: 0,
      description,
    },
    {
      accountId: requiredText(input.dueToAccountId, 'dueToAccountId'),
      debitMinor: 0,
      creditMinor: input.amountMinor,
      description,
    },
  ]
}

export function projectIntercompanyStatusAfterSourcePost(requireReceiveApproval: boolean): IntercompanyTransactionStatus {
  return requireReceiveApproval ? 'pending_receive' : 'source_posted'
}

export function projectIntercompanyStatusAfterReceivePost(): IntercompanyTransactionStatus {
  return 'matched'
}

export function assertReceiveApproverIsNotSourceActor(sourceActorId: string, receiveApproverId: string): void {
  const source = requiredText(sourceActorId, 'sourceActorId')
  const receiver = requiredText(receiveApproverId, 'receiveApproverId')
  if (source === receiver) {
    throw new FinanceValidationError('Receive approval violates separation of duties')
  }
}

export function computeDueToDueFromBalance(input: {
  pairId: string
  orgId: string
  currency: string
  sourceLegalEntityId: string
  sourceBookId: string
  receivingLegalEntityId: string
  receivingBookId: string
  sourceDueFromMinor: number
  sourceDueToMinor: number
  receivingDueFromMinor: number
  receivingDueToMinor: number
  matchedTransactionIds: string[]
  openTransactionIds: string[]
}): DueToDueFromBalance {
  assertMinorUnits(input.sourceDueFromMinor, 'sourceDueFromMinor')
  assertMinorUnits(input.sourceDueToMinor, 'sourceDueToMinor')
  assertMinorUnits(input.receivingDueFromMinor, 'receivingDueFromMinor')
  assertMinorUnits(input.receivingDueToMinor, 'receivingDueToMinor')
  const sourceNetClaimMinor = input.sourceDueFromMinor - input.sourceDueToMinor
  const receivingNetClaimMinor = input.receivingDueFromMinor - input.receivingDueToMinor
  if (!Number.isSafeInteger(sourceNetClaimMinor) || !Number.isSafeInteger(receivingNetClaimMinor)) {
    throw new FinanceValidationError('Due-to/due-from net claim exceeds safe integer precision')
  }
  const differenceMinor = sourceNetClaimMinor + receivingNetClaimMinor
  if (!Number.isSafeInteger(differenceMinor)) {
    throw new FinanceValidationError('Due-to/due-from difference exceeds safe integer precision')
  }
  return {
    pairId: requiredText(input.pairId, 'pairId'),
    orgId: requiredText(input.orgId, 'orgId'),
    currency: requiredText(input.currency, 'currency').toUpperCase(),
    sourceLegalEntityId: requiredText(input.sourceLegalEntityId, 'sourceLegalEntityId'),
    sourceBookId: requiredText(input.sourceBookId, 'sourceBookId'),
    receivingLegalEntityId: requiredText(input.receivingLegalEntityId, 'receivingLegalEntityId'),
    receivingBookId: requiredText(input.receivingBookId, 'receivingBookId'),
    sourceDueFromMinor: input.sourceDueFromMinor,
    sourceDueToMinor: input.sourceDueToMinor,
    receivingDueFromMinor: input.receivingDueFromMinor,
    receivingDueToMinor: input.receivingDueToMinor,
    sourceNetClaimMinor,
    receivingNetClaimMinor,
    reconciled: differenceMinor === 0,
    differenceMinor,
    matchedTransactionIds: [...input.matchedTransactionIds],
    openTransactionIds: [...input.openTransactionIds],
  }
}

export function buildDueToDueFromEliminationLines(input: {
  amountMinor: number
  dueToAccountId: string
  dueFromAccountId: string
  description: string
}): JournalLineInput[] {
  assertSafeInteger(input.amountMinor, 'amountMinor', 1)
  const description = requiredText(input.description, 'description')
  return [
    {
      accountId: requiredText(input.dueToAccountId, 'dueToAccountId'),
      debitMinor: input.amountMinor,
      creditMinor: 0,
      description,
    },
    {
      accountId: requiredText(input.dueFromAccountId, 'dueFromAccountId'),
      debitMinor: 0,
      creditMinor: input.amountMinor,
      description,
    },
  ]
}

export function assertEliminationLinesBalanced(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) throw new FinanceValidationError('Elimination requires at least two balanced lines')
  let debit = 0
  let credit = 0
  for (const [index, line] of lines.entries()) {
    assertMinorUnits(line.debitMinor, `lines[${index}].debitMinor`)
    assertMinorUnits(line.creditMinor, `lines[${index}].creditMinor`)
    if ((line.debitMinor === 0) === (line.creditMinor === 0)) {
      throw new FinanceValidationError(`Elimination line ${index + 1} must be debit-only or credit-only`)
    }
    debit += line.debitMinor
    credit += line.creditMinor
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) {
      throw new FinanceValidationError('Elimination totals exceed safe integer precision')
    }
  }
  if (debit !== credit) throw new FinanceValidationError('Elimination lines must be balanced')
}

export function projectConsolidatedReportingBoundary(input: {
  groupOrgId: string
  consolidationLegalEntityId: string
  consolidationBookId: string
  memberBookIds: readonly string[]
}): ConsolidatedReportingBoundary {
  const consolidationBookId = requiredText(input.consolidationBookId, 'consolidationBookId')
  const memberBookIds = input.memberBookIds.map((id, index) => requiredText(id, `memberBookIds[${index}]`))
  if (memberBookIds.length === 0) throw new FinanceValidationError('Consolidation requires at least one member book')
  if (memberBookIds.includes(consolidationBookId)) {
    throw new FinanceValidationError('Consolidation book cannot be listed as a member entity book')
  }
  if (new Set(memberBookIds).size !== memberBookIds.length) {
    throw new FinanceValidationError('Member books must be unique')
  }
  return {
    kind: 'consolidated_reporting_boundary',
    groupOrgId: requiredText(input.groupOrgId, 'groupOrgId'),
    consolidationLegalEntityId: requiredText(input.consolidationLegalEntityId, 'consolidationLegalEntityId'),
    consolidationBookId,
    memberBookIds,
    entityBooksImmutableUnderElimination: true,
    eliminationsOnlyInConsolidationBook: true,
    composition: 'member_entity_books_plus_consolidation_eliminations',
  }
}

export function assertEliminationTargetIsConsolidationBook(input: {
  bookType: string
  consolidationBookId: string
  targetBookId: string
}): void {
  if (input.bookType !== 'consolidation') {
    throw new FinanceValidationError('Eliminations may only post to a consolidation book')
  }
  if (requiredText(input.targetBookId, 'targetBookId') !== requiredText(input.consolidationBookId, 'consolidationBookId')) {
    throw new FinanceValidationError('Elimination target book must match the consolidation book')
  }
}

export function assertEntityBookNotMutatedByElimination(memberBookIds: readonly string[], targetBookId: string): void {
  if (memberBookIds.includes(targetBookId)) {
    throw new FinanceValidationError('Eliminations must not mutate entity books')
  }
}
