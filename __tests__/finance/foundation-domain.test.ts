import {
  assertBalancedJournal,
  assertJournalScope,
  assertPeriodAllowsPosting,
  buildReversalLines,
  FinanceValidationError,
  resolveRecognitionTiming,
} from '@/lib/accounting/foundation'
import { authorizeFinanceAction, FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'

const scope: FinanceScope = {
  orgId: 'org-a',
  legalEntityId: 'entity-a',
  bookId: 'book-a',
}

const actor: FinanceActorContext = {
  uid: 'user-a',
  orgId: 'org-a',
  membershipRole: 'admin',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [{
    id: 'assignment-a',
    orgId: 'org-a',
    userId: 'user-a',
    legalEntityId: 'entity-a',
    bookId: 'book-a',
    scopeMode: 'book',
    role: 'accountant',
    status: 'active',
  }],
}

describe('finance foundation domain invariants', () => {
  test('requires integer minor units and equal debits and credits', () => {
    expect(() => assertBalancedJournal([
      { accountId: 'cash', debitMinor: 10_000, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 10_000 },
    ])).not.toThrow()

    expect(() => assertBalancedJournal([
      { accountId: 'cash', debitMinor: 10.5, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 10.5 },
    ])).toThrow(FinanceValidationError)

    expect(() => assertBalancedJournal([
      { accountId: 'cash', debitMinor: 10_000, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 9_999 },
    ])).toThrow('Journal is not balanced')
  })

  test('rejects cross-scope lines and closed-period posting', () => {
    expect(() => assertJournalScope(scope, [
      { ...scope, periodId: 'period-a', accountId: 'cash', debitMinor: 1, creditMinor: 0 },
      { ...scope, bookId: 'book-b', periodId: 'period-a', accountId: 'capital', debitMinor: 0, creditMinor: 1 },
    ])).toThrow('Journal line scope does not match entry scope')

    expect(() => assertPeriodAllowsPosting({
      ...scope,
      id: 'period-a',
      startsAt: '2026-07-01',
      endsAt: '2026-07-31',
      status: 'hard_closed',
      fiscalYear: 2027,
      periodNumber: 5,
      version: 1,
    }, '2026-07-15', false)).toThrow('Accounting period is hard closed')
  })

  test('creates exact equal-and-opposite reversal lines', () => {
    expect(buildReversalLines([
      { accountId: 'cash', debitMinor: 12_345, creditMinor: 0, description: 'Receipt' },
      { accountId: 'revenue', debitMinor: 0, creditMinor: 12_345, description: 'Receipt' },
    ])).toEqual([
      { accountId: 'cash', debitMinor: 0, creditMinor: 12_345, description: 'Reversal: Receipt' },
      { accountId: 'revenue', debitMinor: 12_345, creditMinor: 0, description: 'Reversal: Receipt' },
    ])
  })

  test('keeps cash and accrual recognition rules explicit without changing double-entry', () => {
    expect(resolveRecognitionTiming('accrual', 'document_issued')).toBe('recognize')
    expect(resolveRecognitionTiming('cash', 'document_issued')).toBe('memorandum_only')
    expect(resolveRecognitionTiming('cash', 'verified_allocation')).toBe('recognize')
    expect(resolveRecognitionTiming('accrual', 'verified_allocation')).toBe('settle_control_account')
  })

  test('requires active membership, exact scope and a role allowed for the action', () => {
    expect(() => authorizeFinanceAction(actor, scope, 'journal.post')).not.toThrow()
    expect(() => authorizeFinanceAction({ ...actor, orgId: 'org-b' }, scope, 'journal.post'))
      .toThrow(FinanceAuthorizationError)
    expect(() => authorizeFinanceAction({ ...actor, assignments: [] }, scope, 'journal.post'))
      .toThrow('No active finance assignment covers this scope')
    expect(() => authorizeFinanceAction({
      ...actor,
      assignments: [{ ...actor.assignments[0], role: 'finance_viewer' }],
    }, scope, 'journal.post')).toThrow('Finance role cannot perform journal.post')
  })
})
