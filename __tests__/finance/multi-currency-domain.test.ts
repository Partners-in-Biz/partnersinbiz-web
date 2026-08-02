import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  MultiCurrencyFinanceService,
  computeRealizedFxMinor,
  convertTxnToFunctional,
  createEmptyMultiCurrencyStore,
  type MultiCurrencyFinanceStore,
} from '@/lib/finance/multi-currency/service'

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

function serviceWith(storeRef: { current: MultiCurrencyFinanceStore }) {
  return new MultiCurrencyFinanceService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T16:00:00.000Z',
  )
}

describe('multi-currency pure math', () => {
  test('convertTxnToFunctional uses integer scaled rate with half_up', () => {
    // 100000 USD cents * 18.5 (185000000 / 1e8) = 1_850_000 ZAR cents
    expect(convertTxnToFunctional(100_000, 1_850_000_00, 8)).toBe(1_850_000)
    expect(convertTxnToFunctional(1, 15_000_000_00, 8)).toBe(15) // 0.01 * 15 = 0.15 → 15 minor if scale implies units
  })

  test('realized FX gain on AR when settlement rate rises', () => {
    const fx = computeRealizedFxMinor({
      role: 'receivable',
      settledTxnMinor: 100_000,
      originalRateScaled: 1_850_000_00,
      originalRateScale: 8,
      settlementRateScaled: 1_900_000_00,
      settlementRateScale: 8,
    })
    expect(fx.originalFunctionalPortionMinor).toBe(1_850_000)
    expect(fx.settlementFunctionalMinor).toBe(1_900_000)
    expect(fx.realizedFxMinor).toBe(50_000)
  })

  test('realized FX gain on AP when settlement rate falls', () => {
    const fx = computeRealizedFxMinor({
      role: 'payable',
      settledTxnMinor: 100_000,
      originalRateScaled: 1_850_000_00,
      originalRateScale: 8,
      settlementRateScaled: 1_800_000_00,
      settlementRateScale: 8,
    })
    expect(fx.realizedFxMinor).toBe(50_000)
  })
})

describe('multi-currency lifecycle', () => {
  test('FX invoice + payment at different rate realizes FX; reval changes unrealized only', async () => {
    const storeRef = { current: createEmptyMultiCurrencyStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    await svc.configurePolicy(admin, {
      id: 'pol1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      functionalCurrency: 'ZAR',
      realizedFxGainAccountId: 'acc_rg',
      realizedFxLossAccountId: 'acc_rl',
      unrealizedFxGainAccountId: 'acc_ug',
      unrealizedFxLossAccountId: 'acc_ul',
      fxRevaluationClearingAccountId: 'acc_clear',
      requestId: 'r1',
      idempotencyKey: 'idem-pol',
    })

    await svc.createRateSet(admin, {
      id: 'rs1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      functionalCurrency: 'ZAR',
      name: 'USD/ZAR',
      requestId: 'r2',
      idempotencyKey: 'idem-rs',
    })
    await svc.addRate(admin, {
      rateSetId: 'rs1',
      orgId: 'org_pib',
      rateId: 'rate_issue',
      fromCurrency: 'USD',
      toCurrency: 'ZAR',
      rateDate: '2026-08-01',
      rateScaled: 1_850_000_00,
      rateScale: 8,
      source: 'manual',
      requestId: 'r3',
      idempotencyKey: 'idem-rate1',
    })
    await svc.addRate(admin, {
      rateSetId: 'rs1',
      orgId: 'org_pib',
      rateId: 'rate_settle',
      fromCurrency: 'USD',
      toCurrency: 'ZAR',
      rateDate: '2026-08-15',
      rateScaled: 1_900_000_00,
      rateScale: 8,
      source: 'manual',
      requestId: 'r4',
      idempotencyKey: 'idem-rate2',
    })
    await svc.addRate(admin, {
      rateSetId: 'rs1',
      orgId: 'org_pib',
      rateId: 'rate_reval',
      fromCurrency: 'USD',
      toCurrency: 'ZAR',
      rateDate: '2026-08-31',
      rateScaled: 1_920_000_00,
      rateScale: 8,
      source: 'import',
      sourceRef: 'manual-import-csv',
      requestId: 'r5',
      idempotencyKey: 'idem-rate3',
    })
    const approved = await svc.approveRateSet(admin, {
      rateSetId: 'rs1',
      orgId: 'org_pib',
      approvalId: 'appr_rs',
      reason: 'Board approved FX table',
      requestId: 'r6',
      idempotencyKey: 'idem-rs-appr',
    })
    expect(approved.status).toBe('approved_locked')
    expect(approved.externalEgressAllowed).toBe(false)

    // Invoice half remains open after partial settlement path: first full open, settle half, reval remainder
    const { document, position } = await svc.recordDocument(admin, {
      id: 'doc1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      documentType: 'customer_invoice',
      currency: 'USD',
      txnTotalMinor: 100_000,
      rateSetId: 'rs1',
      rateDate: '2026-08-01',
      documentDate: '2026-08-01',
      requestId: 'r7',
      idempotencyKey: 'idem-doc',
    })
    expect(document.currency).toBe('USD')
    expect(document.functionalTotalMinor).toBe(1_850_000)
    expect(document.txnTotalMinor).toBe(100_000)
    expect(position.openTxnMinor).toBe(100_000)

    // Partial settle 40%
    const { settlement, position: afterSettle } = await svc.recordSettlement(admin, {
      id: 'set1',
      orgId: 'org_pib',
      positionId: position.id,
      documentId: document.id,
      settlementDate: '2026-08-15',
      settledTxnMinor: 40_000,
      rateSetId: 'rs1',
      periodId: 'p1',
      requestId: 'r8',
      idempotencyKey: 'idem-set',
    })
    expect(settlement.realizedFxMinor).toBe(20_000) // 40k * (19-18.5) = 20k
    expect(settlement.journalProposal.balanced).toBe(true)
    expect(settlement.journalProposal.totalDebitMinor).toBe(settlement.journalProposal.totalCreditMinor)
    expect(settlement.externalPaymentInitiated).toBe(false)
    expect(afterSettle.openTxnMinor).toBe(60_000)
    expect(afterSettle.realizedFxMinor).toBe(20_000)
    expect(afterSettle.unrealizedFxMinor).toBe(0)
    expect(afterSettle.status).toBe('partially_settled')

    const reval = await svc.createRevaluation(admin, {
      id: 'rev1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      periodId: 'p1',
      asOfDate: '2026-08-31',
      rateSetId: 'rs1',
      reverseNextPeriod: true,
      reversePeriodId: 'p2',
      reversePostingDate: '2026-09-01',
      requestId: 'r9',
      idempotencyKey: 'idem-rev',
    })
    // Remaining 60_000 at 19.2 vs original 18.5 → functional 1_152_000 vs 1_110_000 → +42_000 unrealized
    expect(reval.netUnrealizedMinor).toBe(42_000)
    expect(reval.journalProposal.balanced).toBe(true)
    expect(reval.reverseNextPeriod).toBe(true)
    expect(reval.reverseJournalProposal?.balanced).toBe(true)
    expect(reval.reverseJournalProposal?.purpose).toBe('fx.revaluation_reversal')
    expect(reval.externalPaymentInitiated).toBe(false)
    expect(reval.sarsSubmissionInitiated).toBe(false)

    const approvedReval = await svc.approveRevaluation(admin, {
      id: 'rev1',
      orgId: 'org_pib',
      approvalId: 'appr_rev',
      reason: 'Month-end FX',
      requestId: 'r10',
      idempotencyKey: 'idem-rev-appr',
    })
    expect(approvedReval.status).toBe('approved')

    const posAfter = storeRef.current.positions.get(position.id)!
    expect(posAfter.unrealizedFxMinor).toBe(42_000)
    expect(posAfter.realizedFxMinor).toBe(20_000) // reval must not change realized

    const report = await svc.buildFunctionalReport(admin, {
      id: 'rep1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      asOfDate: '2026-08-31',
      rateSetId: 'rs1',
      requestId: 'r11',
      idempotencyKey: 'idem-rep',
    })
    expect(report.functionalCurrency).toBe('ZAR')
    expect(report.rows[0].currency).toBe('USD')
    expect(report.rows[0].openTxnMinor).toBe(60_000)
    expect(report.totalRealizedFxMinor).toBe(20_000)
    expect(report.totalUnrealizedFxMinor).toBe(42_000)

    // tenant isolation: other org cannot read
    const other = actor('u2', 'org_other')
    await expect(svc.listForOrg(other, 'org_pib')).rejects.toBeInstanceOf(FinanceAuthorizationError)

    const ownList = await svc.listForOrg(admin, 'org_pib', { bookId: 'book_1' })
    expect(ownList.noEgress).toBe(true)
    expect(ownList.externalPaymentInitiated).toBe(false)
    expect(ownList.positions).toHaveLength(1)
    expect(ownList.rateSets[0].status).toBe('approved_locked')

    // cannot mutate approved rate set
    await expect(
      svc.addRate(admin, {
        rateSetId: 'rs1',
        orgId: 'org_pib',
        rateId: 'rate_late',
        fromCurrency: 'USD',
        rateDate: '2026-09-01',
        rateScaled: 2_000_000_00,
        source: 'manual',
        requestId: 'r12',
        idempotencyKey: 'idem-late',
      }),
    ).rejects.toThrow(/approved rate set/i)

    expect(storeRef.current.auditEvents.every((e) => e.externalEgressAllowed === false)).toBe(true)
  })

  test('denies cross-tenant rate set access by not-found', async () => {
    const storeRef = { current: createEmptyMultiCurrencyStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    await svc.configurePolicy(admin, {
      id: 'pol1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      functionalCurrency: 'ZAR',
      realizedFxGainAccountId: 'acc_rg',
      realizedFxLossAccountId: 'acc_rl',
      unrealizedFxGainAccountId: 'acc_ug',
      unrealizedFxLossAccountId: 'acc_ul',
      fxRevaluationClearingAccountId: 'acc_clear',
      requestId: 'r1',
      idempotencyKey: 'idem-pol',
    })
    await svc.createRateSet(admin, {
      id: 'rs1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      functionalCurrency: 'ZAR',
      name: 'USD/ZAR',
      requestId: 'r2',
      idempotencyKey: 'idem-rs',
    })
    const otherAdmin = actor('u9', 'org_other')
    await expect(
      svc.addRate(otherAdmin, {
        rateSetId: 'rs1',
        orgId: 'org_other',
        rateId: 'x',
        fromCurrency: 'USD',
        rateDate: '2026-08-01',
        rateScaled: 1,
        source: 'manual',
        requestId: 'rx',
        idempotencyKey: 'idem-x',
      }),
    ).rejects.toThrow(/not found/i)
  })
})
