import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  CutoverFinanceService,
  computeCutoverTotals,
  createEmptyCutoverStore,
  validateCutoverPackageContents,
  type BookCutoverApplier,
  type CutoverFinanceStore,
  type OpeningJournalPoster,
  type OpeningOpenItemMaterializer,
} from '@/lib/finance/cutover/service'

function actor(uid: string, orgId: string, role: FinanceActorContext['membershipRole'] = 'admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [
            {
              id: 'asg1',
              orgId,
              userId: uid,
              legalEntityId: 'le_1',
              scopeMode: 'entity',
              role: 'finance_admin',
              status: 'active',
            },
          ]
        : [],
  }
}

function serviceWith(storeRef: { current: CutoverFinanceStore }) {
  const poster: OpeningJournalPoster = async ({ journalEntryId }) => ({ id: journalEntryId })
  const materializer: OpeningOpenItemMaterializer = async ({ pkg }) => ({
    openItemIds: pkg.openingOpenItems.map((i) => i.id),
  })
  const bookApplier: BookCutoverApplier = async ({ pkg }) => ({
    bookId: pkg.bookId,
    cutoverAt: pkg.cutoverAt,
    status: 'active',
  })
  return new CutoverFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    poster,
    materializer,
    bookApplier,
    () => '2026-08-02T16:00:00.000Z',
  )
}

const balancedPackageInput = {
  trialBalanceLines: [
    { accountId: 'acc_cash', debitMinor: 100_00, creditMinor: 0, controlAccountRole: 'bank' as const },
    { accountId: 'acc_ar', debitMinor: 150_00, creditMinor: 0, controlAccountRole: 'receivables' as const },
    { accountId: 'acc_ap', debitMinor: 0, creditMinor: 50_00, controlAccountRole: 'payables' as const },
    { accountId: 'acc_eq', debitMinor: 0, creditMinor: 200_00, controlAccountRole: 'retained_earnings' as const },
  ],
  openingOpenItems: [
    {
      id: 'oi_ar_1',
      counterpartyCompanyId: 'cust_1',
      counterpartyRole: 'customer' as const,
      currency: 'ZAR',
      originalMinor: 150_00,
      dueDate: '2026-08-01',
      taxDate: '2026-08-01',
      controlAccountId: 'acc_ar',
      legacySourceRef: 'legacy-inv-1',
    },
    {
      id: 'oi_ap_1',
      counterpartyCompanyId: 'sup_1',
      counterpartyRole: 'supplier' as const,
      currency: 'ZAR',
      originalMinor: 50_00,
      dueDate: '2026-08-01',
      taxDate: '2026-08-01',
      controlAccountId: 'acc_ap',
      legacySourceRef: 'legacy-bill-1',
    },
  ],
}

describe('cutover domain math', () => {
  test('computeCutoverTotals balances and control recon helpers', () => {
    const totals = computeCutoverTotals(balancedPackageInput)
    expect(totals.totalDebitMinor).toBe(250_00)
    expect(totals.totalCreditMinor).toBe(250_00)
    expect(totals.receivablesControlTotalMinor).toBe(150_00)
    expect(totals.payablesControlTotalMinor).toBe(50_00)
    expect(totals.openItemCustomerTotalMinor).toBe(150_00)
    expect(totals.openItemSupplierTotalMinor).toBe(50_00)
    expect(validateCutoverPackageContents({
      ...balancedPackageInput,
      ...totals,
      cutoverAt: '2026-08-01',
      periodId: 'p1',
      currency: 'ZAR',
    })).toEqual([])
  })

  test('validation fails when AR open items drift from control', () => {
    const totals = computeCutoverTotals({
      trialBalanceLines: balancedPackageInput.trialBalanceLines,
      openingOpenItems: [balancedPackageInput.openingOpenItems[0]],
    })
    const errors = validateCutoverPackageContents({
      trialBalanceLines: balancedPackageInput.trialBalanceLines,
      openingOpenItems: [balancedPackageInput.openingOpenItems[0]],
      ...totals,
      cutoverAt: '2026-08-01',
      periodId: 'p1',
      currency: 'ZAR',
    })
    expect(errors.some((e) => /Payables control/i.test(e))).toBe(true)
  })
})

describe('cutover package lifecycle', () => {
  test('create → validate → approve → activate never initiates SARS or payments', async () => {
    const storeRef = { current: createEmptyCutoverStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    const created = await svc.createPackage(admin, {
      id: 'cut_1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      periodId: 'period_1',
      currency: 'ZAR',
      cutoverAt: '2026-08-01',
      description: 'Test cutover',
      ...balancedPackageInput,
      requestId: 'req-1',
      idempotencyKey: 'idem-create-1',
    })
    expect(created.status).toBe('draft')
    expect(created.sarsSubmissionInitiated).toBe(false)
    expect(created.externalPaymentInitiated).toBe(false)
    expect(created.totalDebitMinor).toBe(created.totalCreditMinor)

    const validated = await svc.validatePackage(admin, {
      id: 'cut_1',
      orgId: 'org_pib',
      requestId: 'req-2',
      idempotencyKey: 'idem-val-1',
    })
    expect(validated.status).toBe('validated')
    expect(validated.validationErrors).toEqual([])

    const approved = await svc.approvePackage(admin, {
      id: 'cut_1',
      orgId: 'org_pib',
      approvalId: 'appr_1',
      reason: 'Opening balances signed off',
      requestId: 'req-3',
      idempotencyKey: 'idem-appr-1',
    })
    expect(approved.status).toBe('approved')
    expect(approved.approvalActorId).toBe('u1')

    const activated = await svc.activatePackage(admin, {
      id: 'cut_1',
      orgId: 'org_pib',
      requestId: 'req-4',
      idempotencyKey: 'idem-act-1',
      openingJournalEntryId: 'jnl_open_cut_1',
    })
    expect(activated.status).toBe('activated')
    expect(activated.openingJournalEntryId).toBe('jnl_open_cut_1')
    expect(activated.materializedOpenItemIds).toEqual(['oi_ar_1', 'oi_ap_1'])
    expect(activated.sarsSubmissionInitiated).toBe(false)
    expect(activated.externalPaymentInitiated).toBe(false)
    expect(storeRef.current.bookCutoverClaims.get('org_pib:book_1')).toBe('cut_1')
  })

  test('rejects unbalanced trial balance on validate', async () => {
    const storeRef = { current: createEmptyCutoverStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    await svc.createPackage(admin, {
      id: 'cut_bad',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_2',
      periodId: 'period_1',
      currency: 'ZAR',
      cutoverAt: '2026-08-01',
      description: 'Bad TB',
      trialBalanceLines: [
        { accountId: 'a', debitMinor: 100, creditMinor: 0 },
        { accountId: 'b', debitMinor: 0, creditMinor: 50 },
      ],
      openingOpenItems: [],
      requestId: 'req-b1',
      idempotencyKey: 'idem-b1',
    })
    const failed = await svc.validatePackage(admin, {
      id: 'cut_bad',
      orgId: 'org_pib',
      requestId: 'req-b2',
      idempotencyKey: 'idem-b2',
    })
    expect(failed.status).toBe('failed')
    expect(failed.validationErrors.some((e) => /not balanced/i.test(e))).toBe(true)
  })

  test('member without finance role is denied', async () => {
    const storeRef = { current: createEmptyCutoverStore() }
    const svc = serviceWith(storeRef)
    const member = actor('u2', 'org_pib', 'member')
    await expect(
      svc.createPackage(member, {
        id: 'cut_x',
        orgId: 'org_pib',
        legalEntityId: 'le_1',
        bookId: 'book_x',
        periodId: 'p',
        currency: 'ZAR',
        cutoverAt: '2026-08-01',
        description: 'nope',
        requestId: 'r',
        idempotencyKey: 'k',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })
})
