import type { FinanceApprovalAction, FinanceApprovalEvidence, FinanceScope } from '@/lib/finance/types'
import { canonicalDigest } from '@/lib/finance/integrity'
import type {
  AccountingBook,
  AccountingPeriod,
  BookPolicyVersion,
  JournalLine,
  JournalLineInput,
  LedgerAccount,
  PostedJournalEntry,
} from './types'

export const MAX_JOURNAL_LINES = 200

export class FinanceValidationError extends Error {
  readonly statusCode = 422

  constructor(message: string) {
    super(message)
    this.name = 'FinanceValidationError'
  }
}

function compactImmutableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactImmutableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, compactImmutableValue(item)]))
  }
  return value
}

export function immutableContentHash(value: object): string {
  const withoutHash = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentHash'))
  return canonicalDigest(compactImmutableValue(withoutHash))
}

export function assertImmutableContentHash(value: object & { contentHash?: string }, resource: string): void {
  if (!value.contentHash || immutableContentHash(value) !== value.contentHash) {
    throw new FinanceValidationError(`${resource} content hash is invalid`)
  }
}

export function requiredText(value: string, field: string): string {
  const clean = value?.trim()
  if (!clean) throw new FinanceValidationError(`${field} is required`)
  return clean
}

export function parseCanonicalDate(value: string, field: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FinanceValidationError(`${field} must be a canonical YYYY-MM-DD calendar date`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const epoch = Date.UTC(year, month - 1, day)
  const parsed = new Date(epoch)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new FinanceValidationError(`${field} must be a canonical YYYY-MM-DD calendar date`)
  }
  return epoch
}

export function assertSafeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new FinanceValidationError(`${field} must be a safe integer greater than or equal to ${minimum}`)
  }
}

export function assertCreateVersion(expectedVersion: number, resource: string): void {
  if (expectedVersion !== 0) throw new FinanceValidationError(`${resource} create expectedVersion must be 0`)
}

export function assertEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new FinanceValidationError(`${field} is invalid`)
  }
}

function assertClosedKeys(value: object, allowed: ReadonlySet<string>, resource: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new FinanceValidationError(`${resource} contains unknown or protected fields: ${unknown.join(', ')}`)
  }
}

const POST_JOURNAL_KEYS = new Set([
  'id', 'orgId', 'legalEntityId', 'bookId', 'periodId', 'sourceType', 'sourceId', 'sourceVersion',
  'postingPurpose', 'entryType', 'postingDate', 'documentDate', 'description', 'currency', 'policyVersionId',
  'expectedVersion', 'requestId', 'idempotencyKey', 'approvalId', 'adjustmentApprovalId', 'lines',
  'reversesJournalEntryId', 'reversalReason',
])
const JOURNAL_LINE_INPUT_KEYS = new Set(['accountId', 'debitMinor', 'creditMinor', 'description'])

export function assertClosedPostJournalCommand(command: object): void {
  assertClosedKeys(command, POST_JOURNAL_KEYS, 'Journal command')
  const lines = (command as { lines?: unknown }).lines
  if (!Array.isArray(lines)) throw new FinanceValidationError('Journal command lines must be an array')
  lines.forEach((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new FinanceValidationError(`Journal line ${index + 1} must be an object`)
    }
    assertClosedKeys(line, JOURNAL_LINE_INPUT_KEYS, `Journal line ${index + 1}`)
  })
}

export function allowlistedJournalLine(line: JournalLineInput): JournalLineInput {
  return {
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    ...(line.description === undefined ? {} : { description: line.description }),
  }
}

export function policyRangesOverlap(
  left: Pick<BookPolicyVersion, 'effectiveFrom' | 'effectiveTo'>,
  right: Pick<BookPolicyVersion, 'effectiveFrom' | 'effectiveTo'>,
): boolean {
  const leftFrom = parseCanonicalDate(left.effectiveFrom, 'policy.effectiveFrom')
  const leftTo = left.effectiveTo ? parseCanonicalDate(left.effectiveTo, 'policy.effectiveTo') : Number.POSITIVE_INFINITY
  const rightFrom = parseCanonicalDate(right.effectiveFrom, 'policy.effectiveFrom')
  const rightTo = right.effectiveTo ? parseCanonicalDate(right.effectiveTo, 'policy.effectiveTo') : Number.POSITIVE_INFINITY
  return leftFrom <= rightTo && rightFrom <= leftTo
}

export function resolveUniqueEffectivePolicy(
  policies: readonly BookPolicyVersion[],
  postingDate: string,
  requestedPolicyId?: string,
): BookPolicyVersion {
  const postingEpoch = parseCanonicalDate(postingDate, 'postingDate')
  const effective = policies.filter((policy) => policy.status === 'approved' && policy.immutable &&
    postingEpoch >= parseCanonicalDate(policy.effectiveFrom, 'policy.effectiveFrom') &&
    (!policy.effectiveTo || postingEpoch <= parseCanonicalDate(policy.effectiveTo, 'policy.effectiveTo')))
  if (effective.length !== 1) throw new FinanceValidationError('Posting date must resolve to one unique policy effective for the book')
  if (requestedPolicyId !== undefined && effective[0].id !== requestedPolicyId) {
    throw new FinanceValidationError('Caller-selected policy is not the unique effective book policy')
  }
  assertImmutableContentHash(effective[0], 'Approved book policy')
  return effective[0]
}

const DEFAULT_CONTROL_ROLES: Record<keyof AccountingBook['defaultControlAccountIds'], LedgerAccount['controlAccountRole']> = {
  receivables: 'receivables', payables: 'payables', cash: 'bank', tax: 'tax', retainedEarnings: 'retained_earnings',
}

export function expectedDefaultControlRole(book: AccountingBook, accountId: string): LedgerAccount['controlAccountRole'] | undefined {
  const entry = Object.entries(book.defaultControlAccountIds)
    .find(([, configuredAccountId]) => configuredAccountId === accountId) as
      [keyof AccountingBook['defaultControlAccountIds'], string] | undefined
  return entry ? DEFAULT_CONTROL_ROLES[entry[0]] : undefined
}

export function assertDefaultControlAccountConfiguration(book: AccountingBook, account: LedgerAccount): void {
  const expectedRole = expectedDefaultControlRole(book, account.id)
  if (expectedRole && account.controlAccountRole !== expectedRole) {
    throw new FinanceValidationError(`Control account ${account.id} configuration role is inconsistent and requires an approved authoritative source`)
  }
}

export function assertPostedJournalContentHash(journal: PostedJournalEntry): void {
  const { contentHash, ...content } = journal
  if (canonicalDigest(content) !== contentHash) {
    throw new FinanceValidationError('Original journal content hash does not match full content')
  }
}

export function assertMinorUnits(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative safe integer in minor units`)
  }
}

export function assertBalancedJournal(lines: readonly JournalLineInput[]): { debitMinor: number; creditMinor: number } {
  if (lines.length < 2) throw new FinanceValidationError('A posted journal requires at least two lines')
  if (lines.length > MAX_JOURNAL_LINES) throw new FinanceValidationError(`A journal cannot exceed ${MAX_JOURNAL_LINES} lines`)
  let debitMinor = 0
  let creditMinor = 0
  for (const [index, line] of lines.entries()) {
    requiredText(line.accountId, `lines[${index}].accountId`)
    assertMinorUnits(line.debitMinor, `lines[${index}].debitMinor`)
    assertMinorUnits(line.creditMinor, `lines[${index}].creditMinor`)
    if ((line.debitMinor > 0) === (line.creditMinor > 0)) {
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
    if (line.orgId !== scope.orgId || line.legalEntityId !== scope.legalEntityId || line.bookId !== scope.bookId) {
      throw new FinanceValidationError('Journal line scope does not match entry scope')
    }
  }
}

export function assertPeriodAllowsPosting(
  period: AccountingPeriod,
  postingDate: string,
  adjustmentApproved: boolean,
): void {
  const postingEpoch = parseCanonicalDate(postingDate, 'postingDate')
  const startsEpoch = parseCanonicalDate(period.startsAt, 'period.startsAt')
  const endsEpoch = parseCanonicalDate(period.endsAt, 'period.endsAt')
  if (postingEpoch < startsEpoch || postingEpoch > endsEpoch) {
    throw new FinanceValidationError('Posting date is outside the accounting period')
  }
  if (period.status === 'hard_closed') throw new FinanceValidationError('Accounting period is hard closed')
  if (period.status === 'soft_closed' && !adjustmentApproved) {
    throw new FinanceValidationError('Accounting period is soft closed and requires approved adjustment evidence')
  }
}

export function assertApprovalEvidence(
  approval: FinanceApprovalEvidence | undefined,
  expectedAction: FinanceApprovalAction,
  actorId: string,
): FinanceApprovalEvidence {
  if (!approval) throw new FinanceValidationError(`${expectedAction} approval evidence is required`)
  requiredText(approval.approvalId, 'approval.approvalId')
  requiredText(approval.approvedBy, 'approval.approvedBy')
  requiredText(approval.approvedAt, 'approval.approvedAt')
  requiredText(approval.reason, 'approval.reason')
  if (approval.action !== expectedAction) throw new FinanceValidationError(`approval action must be ${expectedAction}`)
  if (approval.approvedBy === actorId) throw new FinanceValidationError('Approval violates separation of duties')
  return approval
}

interface PostingValidationInput {
  scope: Required<FinanceScope>
  journalId: string
  periodId: string
  postingDate: string
  currency: string
  sourceType: string
  actorId: string
  approval?: FinanceApprovalEvidence
  adjustmentApproved?: boolean
  expectedApprovalAction: 'journal.post' | 'journal.reverse'
  book: AccountingBook
  period: AccountingPeriod
  policy: BookPolicyVersion
  lines: readonly JournalLineInput[]
  accounts: readonly LedgerAccount[]
}

export function validatePostingContext(input: PostingValidationInput): FinanceApprovalEvidence {
  const approval = assertApprovalEvidence(input.approval, input.expectedApprovalAction, input.actorId)
  const totals = assertBalancedJournal(input.lines)
  void totals
  const { scope, book, period, policy } = input
  if (book.id !== scope.bookId || book.bookId !== scope.bookId || book.orgId !== scope.orgId || book.legalEntityId !== scope.legalEntityId) {
    throw new FinanceValidationError('Accounting book not found in exact scope')
  }
  if (period.orgId !== scope.orgId || period.legalEntityId !== scope.legalEntityId || period.bookId !== scope.bookId || period.id !== input.periodId) {
    throw new FinanceValidationError('Accounting period not found in exact scope')
  }
  if (book.status !== 'active') throw new FinanceValidationError('Accounting book is not active')
  const postingEpoch = parseCanonicalDate(input.postingDate, 'postingDate')
  if (!book.cutoverAt) throw new FinanceValidationError('Accounting book has no approved cutover date')
  if (book.cutoverAt && postingEpoch < parseCanonicalDate(book.cutoverAt, 'book.cutoverAt')) {
    throw new FinanceValidationError('Posting date is before the approved book cutover date')
  }
  if (book.bookType === 'consolidation' &&
      !['consolidation', 'elimination', 'journal_reversal'].includes(input.sourceType)) {
    throw new FinanceValidationError('Consolidation books accept only consolidation or elimination postings')
  }
  if (book.functionalCurrency !== input.currency.toUpperCase()) throw new FinanceValidationError('Journal currency does not match book functional currency')
  if (policy.status !== 'approved' || !policy.immutable || policy.orgId !== scope.orgId ||
      policy.legalEntityId !== scope.legalEntityId || policy.bookId !== scope.bookId ||
      !policy.accountingBasis || !policy.taxPointPolicyId) {
    throw new FinanceValidationError('Approved book policy version is invalid for the book')
  }
  const policyFrom = parseCanonicalDate(policy.effectiveFrom, 'policy.effectiveFrom')
  const policyTo = policy.effectiveTo ? parseCanonicalDate(policy.effectiveTo, 'policy.effectiveTo') : undefined
  if (postingEpoch < policyFrom || (policyTo !== undefined && postingEpoch > policyTo)) {
    throw new FinanceValidationError('Posting date is outside the approved policy effective range')
  }
  if (input.expectedApprovalAction === 'journal.reverse' && period.status !== 'open') {
    throw new FinanceValidationError('Journal reversals require an open correction period')
  }
  assertPeriodAllowsPosting(period, input.postingDate, input.adjustmentApproved === true)
  if (input.accounts.length !== input.lines.length) throw new FinanceValidationError('Every journal line requires a loaded account')
  input.lines.forEach((line, index) => {
    const account = input.accounts[index]
    if (!account || account.id !== line.accountId || account.orgId !== scope.orgId ||
        account.legalEntityId !== scope.legalEntityId || account.bookId !== scope.bookId) {
      throw new FinanceValidationError(`Ledger account ${line.accountId} not found in exact scope`)
    }
    if (!account.postingAllowed) throw new FinanceValidationError(`Ledger account ${line.accountId} does not allow posting`)
    const activeFrom = parseCanonicalDate(account.activeFrom, `account.${line.accountId}.activeFrom`)
    const activeTo = account.activeTo ? parseCanonicalDate(account.activeTo, `account.${line.accountId}.activeTo`) : undefined
    if (postingEpoch < activeFrom || (activeTo !== undefined && postingEpoch > activeTo)) {
      throw new FinanceValidationError(`Ledger account ${line.accountId} is inactive on posting date`)
    }
    if (account.currencyPolicy === 'functional_only' && account.currency !== book.functionalCurrency) {
      throw new FinanceValidationError(`Ledger account ${line.accountId} currency does not match book`)
    }
    assertDefaultControlAccountConfiguration(book, account)
    if ((account.controlAccountRole || expectedDefaultControlRole(book, account.id)) && input.sourceType !== 'journal_reversal') {
      throw new FinanceValidationError(`Control account ${line.accountId} requires an approved authoritative source`)
    }
  })
  return approval
}

export function assertStoredLineIdentity(journalId: string, periodId: string, lines: readonly JournalLine[]): void {
  lines.forEach((line, index) => {
    const sequence = index + 1
    if (line.id !== `${journalId}_${String(sequence).padStart(4, '0')}` ||
        line.journalEntryId !== journalId || line.sequence !== sequence || line.periodId !== periodId) {
      throw new FinanceValidationError('Journal line identity or sequence is invalid')
    }
  })
}

export type RecognitionEvent = 'document_issued' | 'verified_allocation'
export type RecognitionTiming = 'recognize' | 'memorandum_only' | 'settle_control_account'

export function resolveRecognitionTiming(basis: 'cash' | 'accrual', event: RecognitionEvent): RecognitionTiming {
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
