import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { AccountingBasis, FinanceActorContext } from '@/lib/finance/types'
import { FinanceValidationError, assertEnumValue, parseCanonicalDate, requiredText } from './foundation'
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
  type BalanceSheetReport,
  type IncomeStatementReport,
  type ReportScope,
  type TrialBalanceReport,
} from './reporting'
import type { AccountingPeriod, LedgerAccount, PostedJournalEntry } from './types'

export interface ReportingStore {
  accounts: Map<string, LedgerAccount>
  journals: Map<string, PostedJournalEntry>
  periods: Map<string, AccountingPeriod>
}

export class FinanceReportingService {
  constructor(private readonly store: ReportingStore) {}

  private assertRead(actor: FinanceActorContext, scope: ReportScope): void {
    authorizeFinanceAction(actor, scope, 'report.read')
  }

  private loadScoped(scope: ReportScope): {
    accounts: LedgerAccount[]
    journals: PostedJournalEntry[]
    periodStatus?: AccountingPeriod['status']
  } {
    const accounts = [...this.store.accounts.values()].filter((account) =>
      account.orgId === scope.orgId && account.legalEntityId === scope.legalEntityId && account.bookId === scope.bookId)
    const journals = [...this.store.journals.values()].filter((journal) =>
      journal.orgId === scope.orgId && journal.legalEntityId === scope.legalEntityId && journal.bookId === scope.bookId &&
      journal.status === 'posted')
    return { accounts, journals }
  }

  trialBalance(actor: FinanceActorContext, input: {
    orgId: string
    legalEntityId: string
    bookId: string
    asOfDate: string
    accountingBasis: AccountingBasis
    periodId?: string
  }): TrialBalanceReport {
    const scope = { orgId: input.orgId, legalEntityId: input.legalEntityId, bookId: input.bookId }
    this.assertRead(actor, scope)
    parseCanonicalDate(input.asOfDate, 'asOfDate')
    assertEnumValue(input.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    const { accounts, journals } = this.loadScoped(scope)
    let periodStatus: AccountingPeriod['status'] | undefined
    if (input.periodId) {
      const period = this.store.periods.get(input.periodId)
      if (!period || period.orgId !== scope.orgId || period.legalEntityId !== scope.legalEntityId || period.bookId !== scope.bookId) {
        throw new FinanceValidationError('Accounting period not found in exact scope')
      }
      periodStatus = period.status
    }
    return buildTrialBalance({
      scope,
      accounts,
      journals,
      asOfDate: input.asOfDate,
      accountingBasis: input.accountingBasis,
      periodStatus,
    })
  }

  incomeStatement(actor: FinanceActorContext, input: {
    orgId: string
    legalEntityId: string
    bookId: string
    fromDate: string
    toDate: string
    accountingBasis: AccountingBasis
  }): IncomeStatementReport {
    const scope = { orgId: input.orgId, legalEntityId: input.legalEntityId, bookId: input.bookId }
    this.assertRead(actor, scope)
    requiredText(input.fromDate, 'fromDate')
    requiredText(input.toDate, 'toDate')
    assertEnumValue(input.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    const { accounts, journals } = this.loadScoped(scope)
    return buildIncomeStatement({
      scope,
      accounts,
      journals,
      fromDate: input.fromDate,
      toDate: input.toDate,
      accountingBasis: input.accountingBasis,
    })
  }

  balanceSheet(actor: FinanceActorContext, input: {
    orgId: string
    legalEntityId: string
    bookId: string
    asOfDate: string
    accountingBasis: AccountingBasis
    retainedEarningsAccountId?: string
  }): BalanceSheetReport {
    const scope = { orgId: input.orgId, legalEntityId: input.legalEntityId, bookId: input.bookId }
    this.assertRead(actor, scope)
    parseCanonicalDate(input.asOfDate, 'asOfDate')
    assertEnumValue(input.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    const { accounts, journals } = this.loadScoped(scope)
    return buildBalanceSheet({
      scope,
      accounts,
      journals,
      asOfDate: input.asOfDate,
      accountingBasis: input.accountingBasis,
      retainedEarningsAccountId: input.retainedEarningsAccountId,
    })
  }
}
