import type { VersionedFinanceRecord } from '@/lib/finance/types'
import type { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { JournalLineInput } from './types'

export type IntercompanyPairStatus = 'draft' | 'active' | 'disabled'

export type IntercompanyTransactionType =
  | 'charge'
  | 'recharge'
  | 'loan'
  | 'equity_contribution'
  | 'other'

export type IntercompanyTransactionStatus =
  | 'proposed'
  | 'source_posted'
  | 'pending_receive'
  | 'matched'
  | 'rejected'
  | 'reversed'

export type EliminationRuleStatus = 'draft' | 'approved' | 'disabled'
export type ConsolidationRunStatus = 'draft' | 'pinned' | 'posted' | 'approved' | 'reversed'
export type ConsolidationEntryStatus = 'draft' | 'posted' | 'reversed'

export interface IntercompanyPair extends VersionedFinanceRecord {
  /** Group/workspace org that owns the pair configuration. */
  groupOrgId: string
  sourceLegalEntityId: string
  sourceBookId: string
  receivingLegalEntityId: string
  receivingBookId: string
  /** Source entity control account for amounts owed by the counterparty. */
  sourceDueFromAccountId: string
  /** Source entity control account for amounts owed to the counterparty. */
  sourceDueToAccountId: string
  /** Receiving entity control account for amounts owed by the counterparty. */
  receivingDueFromAccountId: string
  /** Receiving entity control account for amounts owed to the counterparty. */
  receivingDueToAccountId: string
  enabledTransactionTypes: IntercompanyTransactionType[]
  requireReceiveApproval: boolean
  status: IntercompanyPairStatus
  pairKey: string
  currency: string
}

export interface IntercompanySideProposal {
  legalEntityId: string
  bookId: string
  amountMinor: number
  currency: string
  counterpartyAccountId: string
  pnlAccountId: string
  description: string
  journalEntryId?: string
  journalLines?: JournalLineInput[]
  postedAt?: string
  postedBy?: string
}

export interface IntercompanyTransaction extends VersionedFinanceRecord {
  pairId: string
  transactionType: IntercompanyTransactionType
  status: IntercompanyTransactionStatus
  transactionDate: string
  currency: string
  amountMinor: number
  description: string
  source: IntercompanySideProposal
  receiving: IntercompanySideProposal
  rateSnapshot?: { baseCurrency: string; quoteCurrency: string; rateNumerator: number; rateDenominator: number }
  sourcePostedAt?: string
  receiveApprovalId?: string
  receiveApprovedAt?: string
  receiveApprovedBy?: string
  rejectedReason?: string
  rejectedAt?: string
  rejectedBy?: string
  matchedAt?: string
  reversedTransactionId?: string
  reversesTransactionId?: string
  immutable: boolean
  contentHash?: string
}

export interface DueToDueFromBalance {
  pairId: string
  orgId: string
  currency: string
  sourceLegalEntityId: string
  sourceBookId: string
  receivingLegalEntityId: string
  receivingBookId: string
  /** Source book due-from control balance (debit-positive). */
  sourceDueFromMinor: number
  /** Source book due-to control balance (credit-positive). */
  sourceDueToMinor: number
  /** Receiving book due-from control balance (debit-positive). */
  receivingDueFromMinor: number
  /** Receiving book due-to control balance (credit-positive). */
  receivingDueToMinor: number
  /** Net source claim on receiving (due-from - due-to). */
  sourceNetClaimMinor: number
  /** Net receiving claim on source (due-from - due-to). */
  receivingNetClaimMinor: number
  /** True when source net claim equals receiving net liability (negated receiving net claim). */
  reconciled: boolean
  differenceMinor: number
  matchedTransactionIds: string[]
  openTransactionIds: string[]
}

export type EliminationDimension = 'due_to_due_from' | 'income_expense' | 'custom'

export interface EliminationRule extends VersionedFinanceRecord {
  groupOrgId: string
  code: string
  name: string
  status: EliminationRuleStatus
  dimension: EliminationDimension
  pairId?: string
  consolidationBookId: string
  consolidationLegalEntityId: string
  debitAccountId: string
  creditAccountId: string
  versionNumber: number
  immutable: boolean
  contentHash?: string
  approvalId?: string
  approvedAt?: string
  approvedBy?: string
}

export interface ConsolidationMemberBook {
  legalEntityId: string
  bookId: string
  periodId: string
  journalCutoffEntryNumber?: number
}

export interface ConsolidationRun extends VersionedFinanceRecord {
  groupOrgId: string
  consolidationLegalEntityId: string
  consolidationBookId: string
  consolidationPeriodId: string
  asOfDate: string
  status: ConsolidationRunStatus
  memberBooks: ConsolidationMemberBook[]
  eliminationRuleIds: string[]
  eliminationRuleVersions: Array<{ ruleId: string; versionNumber: number; contentHash?: string }>
  rateSetId?: string
  sourceCutoffDigest: string
  entryIds: string[]
  approvalId?: string
  approvedAt?: string
  approvedBy?: string
  immutable: boolean
  contentHash?: string
  reversesRunId?: string
}

export interface ConsolidationEntry extends VersionedFinanceRecord {
  runId: string
  consolidationLegalEntityId: string
  consolidationBookId: string
  consolidationPeriodId: string
  ruleId: string
  ruleVersionNumber: number
  pairId?: string
  status: ConsolidationEntryStatus
  description: string
  amountMinor: number
  currency: string
  lines: JournalLineInput[]
  journalEntryId?: string
  sourceTransactionIds: string[]
  immutable: boolean
  contentHash?: string
}

export interface ConsolidatedReportingBoundary {
  kind: 'consolidated_reporting_boundary'
  groupOrgId: string
  consolidationLegalEntityId: string
  consolidationBookId: string
  memberBookIds: string[]
  /** Entity books retain full attribution; never mutated by eliminations. */
  entityBooksImmutableUnderElimination: true
  /** Eliminations post only into the consolidation book. */
  eliminationsOnlyInConsolidationBook: true
  /** Consolidated view = sum(member entity books) + consolidation book eliminations. */
  composition: 'member_entity_books_plus_consolidation_eliminations'
}

export type IntercompanyAuditEventType =
  | 'intercompany_pair.created'
  | 'intercompany_pair.activated'
  | 'intercompany_pair.disabled'
  | 'intercompany_transaction.proposed'
  | 'intercompany_transaction.source_posted'
  | 'intercompany_transaction.receive_approved'
  | 'intercompany_transaction.receiving_posted'
  | 'intercompany_transaction.matched'
  | 'intercompany_transaction.rejected'
  | 'intercompany_transaction.reversed'
  | 'elimination_rule.created'
  | 'elimination_rule.approved'
  | 'consolidation_run.created'
  | 'consolidation_run.pinned'
  | 'consolidation_run.posted'
  | 'consolidation_run.approved'
  | 'consolidation_entry.posted'

export interface IntercompanyAuditEvent {
  id: string
  schemaVersion: 1
  orgId: string
  legalEntityId: string
  bookId?: string
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  eventType: IntercompanyAuditEventType
  actorId: string
  requestId?: string
  idempotencyKey?: string
  reason?: string
  occurredAt: string
  sequence: number
  previousEventId?: string
  previousEventHash?: string
  eventHash: string
  payload: Record<string, unknown>
  externalEgressAllowed: false
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
}
