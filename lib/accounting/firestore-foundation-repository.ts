import { createHash } from 'crypto'
import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import { assertBalancedJournal, assertPeriodAllowsPosting, FinanceValidationError } from './foundation'
import type {
  AccountingBook,
  AccountingPeriod,
  FinanceAuditEvent,
  FinanceBranch,
  FinanceOutboxEvent,
  LedgerAccount,
  LegalEntity,
  PostedJournalEntry,
} from './types'

const COLLECTION_BY_TYPE = {
  legal_entity: 'legal_entities',
  finance_branch: 'finance_branches',
  accounting_book: 'accounting_books',
  accounting_period: 'accounting_periods',
  ledger_account: 'ledger_accounts',
} as const

type FoundationRecord = LegalEntity | FinanceBranch | AccountingBook | AccountingPeriod | LedgerAccount
type FoundationType = keyof typeof COLLECTION_BY_TYPE

interface FirestoreRepositoryOptions {
  db?: Firestore
  now?: () => string
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function scopeKey(scope: FinanceScope): string {
  return hash(`${scope.orgId}:${scope.legalEntityId}:${scope.bookId ?? 'entity'}`).slice(0, 40)
}

function assertScope(data: DocumentData | undefined, scope: FinanceScope, resource: string): void {
  if (!data || data.orgId !== scope.orgId || data.legalEntityId !== scope.legalEntityId) {
    throw new FinanceValidationError(`${resource} not found in scope`)
  }
  if (scope.bookId && data.bookId !== scope.bookId && data.id !== scope.bookId) {
    throw new FinanceValidationError(`${resource} not found in book scope`)
  }
}

function asRecord<T>(snapshot: { exists: boolean; data(): DocumentData | undefined }, resource: string): T {
  if (!snapshot.exists) throw new FinanceValidationError(`${resource} not found in scope`)
  return snapshot.data() as T
}

export class FirestoreFinanceFoundationRepository {
  private readonly db: Firestore
  private readonly now: () => string

  constructor(options: FirestoreRepositoryOptions = {}) {
    this.db = options.db ?? adminDb
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async createFoundationRecord(
    actor: FinanceActorContext,
    type: FoundationType,
    record: FoundationRecord,
    uniqueClaimKey: string,
  ): Promise<FoundationRecord> {
    authorizeFinanceAction(actor, record, 'foundation.configure', this.now())
    if (record.version !== 1 || record.schemaVersion !== 1) {
      throw new FinanceValidationError('New finance foundation records must start at schemaVersion 1 and version 1')
    }
    const collection = COLLECTION_BY_TYPE[type]
    const bookId = 'bookId' in record ? record.bookId : undefined
    const recordRef = this.db.collection(collection).doc(record.id)
    const claimId = hash(`${type}:${record.orgId}:${record.legalEntityId}:${bookId ?? ''}:${uniqueClaimKey}`)
    const claimRef = this.db.collection('finance_unique_claims').doc(claimId)
    const now = this.now()

    await this.db.runTransaction(async (tx) => {
      const [existing, existingClaim] = await Promise.all([tx.get(recordRef), tx.get(claimRef)])
      if (existing.exists) throw new FinanceValidationError(`${type} already exists`)
      if (existingClaim.exists) throw new FinanceValidationError(`${type} unique key already exists`)
      const evidence = await this.prepareEvidence(
        tx, actor, record, type, record.id, record.version,
        `finance.${type.replaceAll('_', '-')}.created.v1`, now,
      )
      tx.create(claimRef, {
        schemaVersion: 1,
        claimType: type,
        normalizedKey: uniqueClaimKey,
        orgId: record.orgId,
        legalEntityId: record.legalEntityId,
        bookId,
        aggregateId: record.id,
        createdAt: now,
        createdBy: actor.uid,
      })
      tx.create(recordRef, record)
      this.writeEvidence(tx, evidence)
    })
    return record
  }

  async commitPostedJournal(actor: FinanceActorContext, journal: PostedJournalEntry): Promise<PostedJournalEntry> {
    authorizeFinanceAction(actor, journal, journal.reversesJournalEntryId ? 'journal.reverse' : 'journal.post', this.now())
    const totals = assertBalancedJournal(journal.lines)
    if (journal.status !== 'posted' || journal.immutable !== true) throw new FinanceValidationError('Only immutable posted journals may enter the ledger')
    if (journal.totalDebitMinor !== totals.debitMinor || journal.totalCreditMinor !== totals.creditMinor) {
      throw new FinanceValidationError('Journal stored totals do not match its lines')
    }

    const scope = { orgId: journal.orgId, legalEntityId: journal.legalEntityId, bookId: journal.bookId }
    const journalRef = this.db.collection('journal_entries').doc(journal.id)
    const bookRef = this.db.collection('accounting_books').doc(journal.bookId)
    const periodRef = this.db.collection('accounting_periods').doc(journal.periodId)
    const accountRefs = journal.lines.map((line) => this.db.collection('ledger_accounts').doc(line.accountId))
    const sourceClaimId = hash([
      journal.orgId, journal.legalEntityId, journal.bookId, journal.sourceType,
      journal.sourceId, journal.sourceVersion, journal.postingPurpose,
    ].join(':'))
    const sourceClaimRef = this.db.collection('finance_unique_claims').doc(`posting_${sourceClaimId}`)
    const reversalClaimRef = journal.reversesJournalEntryId
      ? this.db.collection('finance_unique_claims').doc(`reversal_${hash(journal.reversesJournalEntryId)}`)
      : null
    const sequenceRef = this.db.collection('finance_sequences').doc(`journal_${scopeKey(scope)}`)
    const now = this.now()

    const committedJournal = await this.db.runTransaction(async (tx) => {
      const refs: DocumentReference[] = [journalRef, bookRef, periodRef, sourceClaimRef, sequenceRef, ...accountRefs]
      if (reversalClaimRef) refs.push(reversalClaimRef)
      const snapshots = await tx.getAll(...refs)
      const [journalSnapshot, bookSnapshot, periodSnapshot, sourceClaimSnapshot, sequenceSnapshot] = snapshots
      if (journalSnapshot.exists) throw new FinanceValidationError('Journal already exists')
      if (sourceClaimSnapshot.exists) throw new FinanceValidationError('Posting source already exists')
      const book = asRecord<AccountingBook>(bookSnapshot, 'Accounting book')
      const period = asRecord<AccountingPeriod>(periodSnapshot, 'Accounting period')
      assertScope(book, scope, 'Accounting book')
      assertScope(period, scope, 'Accounting period')
      if (book.status !== 'active') throw new FinanceValidationError('Accounting book is not active')
      if (book.functionalCurrency !== journal.currency) throw new FinanceValidationError('Journal currency does not match book functional currency')
      assertPeriodAllowsPosting(period, journal.postingDate, journal.entryType === 'reversal' || journal.entryType === 'adjustment')

      const accountOffset = 5
      journal.lines.forEach((line, index) => {
        const account = asRecord<LedgerAccount>(snapshots[accountOffset + index], `Ledger account ${line.accountId}`)
        assertScope(account, scope, `Ledger account ${line.accountId}`)
        if (!account.postingAllowed) throw new FinanceValidationError(`Ledger account ${line.accountId} does not allow posting`)
        if (line.orgId !== scope.orgId || line.legalEntityId !== scope.legalEntityId || line.bookId !== scope.bookId || line.periodId !== journal.periodId) {
          throw new FinanceValidationError('Journal line scope does not match entry scope')
        }
      })

      if (reversalClaimRef) {
        const reversalClaimSnapshot = snapshots.at(-1)
        if (reversalClaimSnapshot?.exists) throw new FinanceValidationError('Journal already has a direct reversal')
      }
      const previousSequence = sequenceSnapshot.exists ? Number(sequenceSnapshot.data()?.value ?? 0) : 0
      const entryNumber = previousSequence + 1
      const storedJournal: PostedJournalEntry = {
        ...journal,
        entryNumber,
        contentHash: hash({ ...journal, entryNumber, contentHash: undefined }),
      }
      const evidence = await this.prepareEvidence(
        tx, actor, scope, 'journal_entry', storedJournal.id, storedJournal.version, 'finance.journal.posted.v1', now,
      )

      tx.create(sourceClaimRef, {
        schemaVersion: 1, claimType: 'posting_source', aggregateId: journal.id, ...scope,
        sourceType: journal.sourceType, sourceId: journal.sourceId, sourceVersion: journal.sourceVersion,
        postingPurpose: journal.postingPurpose, createdAt: now, createdBy: actor.uid,
      })
      if (reversalClaimRef) {
        tx.create(reversalClaimRef, {
          schemaVersion: 1, claimType: 'journal_reversal', aggregateId: journal.id,
          originalJournalId: journal.reversesJournalEntryId, ...scope, createdAt: now, createdBy: actor.uid,
        })
      }
      tx.set(sequenceRef, { ...scope, value: entryNumber, updatedAt: now }, { merge: true })
      tx.create(journalRef, { ...storedJournal, lines: undefined })
      storedJournal.lines.forEach((line) => tx.create(this.db.collection('journal_lines').doc(line.id), line))
      this.writeEvidence(tx, evidence)
      return storedJournal
    })
    return committedJournal
  }

  private async prepareEvidence(
    tx: Transaction,
    actor: FinanceActorContext,
    scope: FinanceScope,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    eventType: string,
    now: string,
  ): Promise<{ audit: FinanceAuditEvent; outbox: FinanceOutboxEvent; headRef: DocumentReference }> {
    const headRef = this.db.collection('finance_audit_heads').doc(scopeKey(scope))
    const headSnapshot = await tx.get(headRef)
    const head = headSnapshot.data() ?? {}
    const sequence = headSnapshot.exists ? Number(head.sequence ?? -1) + 1 : 0
    const auditId = `audit_${hash(`${scopeKey(scope)}:${sequence}:${aggregateType}:${aggregateId}:${eventType}`).slice(0, 40)}`
    const eventWithoutHash = {
      ...scope,
      id: auditId,
      schemaVersion: 1 as const,
      aggregateType,
      aggregateId,
      aggregateVersion,
      eventType,
      actorId: actor.uid,
      correlationId: actor.correlationId,
      delegationId: actor.delegationId,
      occurredAt: now,
      sequence,
      previousEventId: head.eventId,
      previousEventHash: head.eventHash,
    }
    const eventHash = hash(eventWithoutHash)
    const audit: FinanceAuditEvent = { ...eventWithoutHash, eventHash }
    const outbox: FinanceOutboxEvent = {
      ...scope,
      id: `outbox_${auditId.slice(6)}`,
      schemaVersion: 1,
      eventType,
      aggregateType,
      aggregateId,
      payload: { aggregateId, aggregateVersion, orgId: scope.orgId },
      deliveryStatus: 'internal_pending',
      externalEgressAllowed: false,
      createdAt: now,
    }
    return { audit, outbox, headRef }
  }

  private writeEvidence(
    tx: Transaction,
    evidence: { audit: FinanceAuditEvent; outbox: FinanceOutboxEvent; headRef: DocumentReference },
  ): void {
    tx.create(this.db.collection('finance_audit_events').doc(evidence.audit.id), evidence.audit)
    tx.create(this.db.collection('finance_outbox_events').doc(evidence.outbox.id), evidence.outbox)
    tx.set(evidence.headRef, {
      orgId: evidence.audit.orgId,
      legalEntityId: evidence.audit.legalEntityId,
      bookId: evidence.audit.bookId,
      eventId: evidence.audit.id,
      eventHash: evidence.audit.eventHash,
      sequence: evidence.audit.sequence,
      updatedAt: evidence.audit.occurredAt,
    }, { merge: false })
  }
}
