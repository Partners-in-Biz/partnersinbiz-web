import type { Firestore } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceReportingService, type ReportingStore } from './reporting-service'
import type { AccountingPeriod, JournalLine, LedgerAccount, PostedJournalEntry } from './types'

export class FirestoreFinanceReportingGateway {
  private readonly db: Firestore

  constructor(options: { db?: Firestore } = {}) {
    this.db = options.db ?? adminDb
  }

  private async loadStore(scope: { orgId: string; legalEntityId: string; bookId: string }): Promise<ReportingStore> {
    const [accountsSnap, journalsSnap, periodsSnap, linesSnap] = await Promise.all([
      this.db.collection('ledger_accounts')
        .where('orgId', '==', scope.orgId)
        .where('legalEntityId', '==', scope.legalEntityId)
        .where('bookId', '==', scope.bookId)
        .get(),
      this.db.collection('journal_entries')
        .where('orgId', '==', scope.orgId)
        .where('legalEntityId', '==', scope.legalEntityId)
        .where('bookId', '==', scope.bookId)
        .get(),
      this.db.collection('accounting_periods')
        .where('orgId', '==', scope.orgId)
        .where('legalEntityId', '==', scope.legalEntityId)
        .where('bookId', '==', scope.bookId)
        .get(),
      this.db.collection('journal_lines')
        .where('orgId', '==', scope.orgId)
        .where('legalEntityId', '==', scope.legalEntityId)
        .where('bookId', '==', scope.bookId)
        .get(),
    ])

    const linesByJournal = new Map<string, JournalLine[]>()
    for (const doc of linesSnap.docs) {
      const line = doc.data() as JournalLine
      const list = linesByJournal.get(line.journalEntryId) ?? []
      list.push(line)
      linesByJournal.set(line.journalEntryId, list)
    }

    const accounts = new Map<string, LedgerAccount>()
    for (const doc of accountsSnap.docs) {
      const account = doc.data() as LedgerAccount
      accounts.set(account.id, account)
    }

    const journals = new Map<string, PostedJournalEntry>()
    for (const doc of journalsSnap.docs) {
      const journal = doc.data() as PostedJournalEntry
      const lines = (linesByJournal.get(journal.id) ?? []).sort((a, b) => a.sequence - b.sequence)
      journals.set(journal.id, { ...journal, lines })
    }

    const periods = new Map<string, AccountingPeriod>()
    for (const doc of periodsSnap.docs) {
      const period = doc.data() as AccountingPeriod
      periods.set(period.id, period)
    }

    return { accounts, journals, periods }
  }

  async trialBalance(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      asOfDate: string
      accountingBasis: 'cash' | 'accrual'
      periodId?: string
    },
  ) {
    const store = await this.loadStore(input)
    return new FinanceReportingService(store).trialBalance(actor, input)
  }

  async incomeStatement(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      fromDate: string
      toDate: string
      accountingBasis: 'cash' | 'accrual'
    },
  ) {
    const store = await this.loadStore(input)
    return new FinanceReportingService(store).incomeStatement(actor, input)
  }

  async balanceSheet(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      asOfDate: string
      accountingBasis: 'cash' | 'accrual'
      retainedEarningsAccountId?: string
    },
  ) {
    const store = await this.loadStore(input)
    return new FinanceReportingService(store).balanceSheet(actor, input)
  }
}
