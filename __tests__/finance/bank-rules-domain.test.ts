import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  BankRulesFinanceService,
  createEmptyBankRulesStore,
  matchesBankRule,
  type BankRulesStore,
} from '@/lib/finance/bank-rules/service'

function actor(uid: string, orgId: string, role: FinanceActorContext['membershipRole'] = 'admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [{ id: 'asg1', orgId, userId: uid, legalEntityId: 'le_1', scopeMode: 'entity', role: 'finance_admin', status: 'active' }]
        : [],
  }
}

function serviceWith(storeRef: { current: BankRulesStore }) {
  return new BankRulesFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T18:00:00.000Z',
  )
}

describe('bank rules matching', () => {
  test('contains description match is case-insensitive', () => {
    expect(
      matchesBankRule(
        { field: 'description', operator: 'contains', value: 'rent' },
        { amountMinor: -100, description: 'Office RENT August' },
      ),
    ).toBe(true)
    expect(
      matchesBankRule(
        { field: 'description', operator: 'contains', value: 'rent' },
        { amountMinor: -100, description: 'Client receipt' },
      ),
    ).toBe(false)
  })

  test('amount_between inclusive', () => {
    expect(
      matchesBankRule(
        { field: 'amount', operator: 'amount_between', amountMinor: -30000, amountMaxMinor: -20000 },
        { amountMinor: -25000, description: 'x' },
      ),
    ).toBe(true)
  })
})

describe('bank rules lifecycle', () => {
  test('evaluate creates pending suggestion; accept never auto-posts', async () => {
    const storeRef = { current: createEmptyBankRulesStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    await svc.upsertRule(admin, {
      id: 'rule1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      name: 'Rent',
      priority: 1,
      match: { field: 'description', operator: 'contains', value: 'rent' },
      action: { kind: 'suggest_expense_account', accountId: 'acc_rent' },
      requestId: 'r1',
      idempotencyKey: 'idem-rule',
    })

    const suggestions = await svc.evaluate(admin, {
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      bankAccountId: 'bank1',
      bankTransactions: [
        { id: 'tx1', amountMinor: -25000, description: 'Office rent', reconciliationState: 'unmatched' },
        { id: 'tx2', amountMinor: 10000, description: 'Client paid', reconciliationState: 'unmatched' },
      ],
      requestId: 'r2',
      idempotencyKey: 'idem-eval',
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].status).toBe('pending')
    expect(suggestions[0].autoPosted).toBe(false)
    expect(suggestions[0].externalPaymentInitiated).toBe(false)

    const accepted = await svc.acceptSuggestion(admin, {
      id: suggestions[0].id,
      orgId: 'org_pib',
      requestId: 'r3',
      idempotencyKey: 'idem-acc',
      resolutionNote: 'ok',
    })
    expect(accepted.status).toBe('accepted')
    expect(accepted.autoPosted).toBe(false)
    expect(accepted.externalPaymentInitiated).toBe(false)
  })

  test('viewer cannot configure rules', async () => {
    const storeRef = { current: createEmptyBankRulesStore() }
    const svc = serviceWith(storeRef)
    const viewer: FinanceActorContext = {
      uid: 'v1',
      orgId: 'org_pib',
      membershipRole: 'member',
      membershipActive: true,
      financeModuleEnabled: true,
      assignments: [
        { id: 'a', orgId: 'org_pib', userId: 'v1', legalEntityId: 'le_1', scopeMode: 'entity', role: 'finance_viewer', status: 'active' },
      ],
    }
    await expect(
      svc.upsertRule(viewer, {
        id: 'rulex',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        name: 'x',
        match: { field: 'description', operator: 'contains', value: 'x' },
        action: { kind: 'flag_review' },
        requestId: 'r',
        idempotencyKey: 'i',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })
})
