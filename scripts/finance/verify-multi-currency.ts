/**
 * Development verification for multi-currency books / FX rates / revaluation.
 * No SARS submit, no external payment initiate, no production deploy.
 */
import assert from 'assert'
import {
  MultiCurrencyFinanceService,
  computeRealizedFxMinor,
  convertTxnToFunctional,
  createEmptyMultiCurrencyStore,
  type MultiCurrencyFinanceStore,
} from '../../lib/finance/multi-currency/service'
import type { FinanceActorContext } from '../../lib/finance/types'

function actor(uid: string, orgId: string): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg1',
        orgId,
        userId: uid,
        legalEntityId: 'le_1',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

async function main() {
  assert.strictEqual(convertTxnToFunctional(100_000, 1_850_000_000, 8), 1_850_000)
  const realized = computeRealizedFxMinor({
    role: 'receivable',
    settledTxnMinor: 100_000,
    originalRateScaled: 1_850_000_000,
    originalRateScale: 8,
    settlementRateScaled: 1_900_000_000,
    settlementRateScale: 8,
  })
  assert.strictEqual(realized.realizedFxMinor, 50_000)

  const storeRef: { current: MultiCurrencyFinanceStore } = { current: createEmptyMultiCurrencyStore() }
  const svc = new MultiCurrencyFinanceService(
    async () => storeRef.current,
    async (_b, a) => {
      storeRef.current = a
    },
    () => '2026-08-02T12:00:00.000Z',
  )
  const admin = actor('verify', 'org_verify_fx')

  await svc.configurePolicy(admin, {
    id: 'pol',
    orgId: 'org_verify_fx',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    functionalCurrency: 'ZAR',
    realizedFxGainAccountId: 'g',
    realizedFxLossAccountId: 'l',
    unrealizedFxGainAccountId: 'ug',
    unrealizedFxLossAccountId: 'ul',
    fxRevaluationClearingAccountId: 'c',
    requestId: '1',
    idempotencyKey: 'p',
  })
  await svc.createRateSet(admin, {
    id: 'rs',
    orgId: 'org_verify_fx',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    functionalCurrency: 'ZAR',
    name: 'USD',
    requestId: '2',
    idempotencyKey: 'rs',
  })
  await svc.addRate(admin, {
    rateSetId: 'rs',
    orgId: 'org_verify_fx',
    rateId: 'r1',
    fromCurrency: 'USD',
    rateDate: '2026-08-01',
    rateScaled: 1_850_000_000,
    source: 'manual',
    requestId: '3',
    idempotencyKey: 'r1',
  })
  await svc.addRate(admin, {
    rateSetId: 'rs',
    orgId: 'org_verify_fx',
    rateId: 'r2',
    fromCurrency: 'USD',
    rateDate: '2026-08-20',
    rateScaled: 1_900_000_000,
    source: 'manual',
    requestId: '4',
    idempotencyKey: 'r2',
  })
  await svc.approveRateSet(admin, {
    rateSetId: 'rs',
    orgId: 'org_verify_fx',
    approvalId: 'a1',
    reason: 'ok',
    requestId: '5',
    idempotencyKey: 'ap',
  })
  const { position } = await svc.recordDocument(admin, {
    id: 'd1',
    orgId: 'org_verify_fx',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    documentType: 'customer_invoice',
    currency: 'USD',
    txnTotalMinor: 100_000,
    rateSetId: 'rs',
    rateDate: '2026-08-01',
    documentDate: '2026-08-01',
    requestId: '6',
    idempotencyKey: 'd',
  })
  const { settlement } = await svc.recordSettlement(admin, {
    id: 's1',
    orgId: 'org_verify_fx',
    positionId: position.id,
    settlementDate: '2026-08-20',
    settledTxnMinor: 100_000,
    rateSetId: 'rs',
    periodId: 'p1',
    requestId: '7',
    idempotencyKey: 's',
  })
  assert.strictEqual(settlement.realizedFxMinor, 50_000)
  assert.strictEqual(settlement.journalProposal.balanced, true)
  assert.strictEqual(settlement.externalPaymentInitiated, false)

  // second open doc for reval
  const { position: p2 } = await svc.recordDocument(admin, {
    id: 'd2',
    orgId: 'org_verify_fx',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    documentType: 'customer_invoice',
    currency: 'USD',
    txnTotalMinor: 50_000,
    rateSetId: 'rs',
    rateDate: '2026-08-01',
    documentDate: '2026-08-01',
    requestId: '8',
    idempotencyKey: 'd2',
  })
  await svc.addRate(admin, {
    rateSetId: 'rs',
    orgId: 'org_verify_fx',
    rateId: 'r3',
    fromCurrency: 'USD',
    rateDate: '2026-08-31',
    rateScaled: 1_950_000_000,
    source: 'manual',
    requestId: '9',
    idempotencyKey: 'r3-fail-expected',
  }).catch(() => undefined)

  // approved set cannot add — create fresh set for reval rate
  await svc.createRateSet(admin, {
    id: 'rs2',
    orgId: 'org_verify_fx',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    functionalCurrency: 'ZAR',
    name: 'USD reval',
    requestId: '10',
    idempotencyKey: 'rs2',
  })
  await svc.addRate(admin, {
    rateSetId: 'rs2',
    orgId: 'org_verify_fx',
    rateId: 'rr',
    fromCurrency: 'USD',
    rateDate: '2026-08-31',
    rateScaled: 1_950_000_000,
    source: 'manual',
    requestId: '11',
    idempotencyKey: 'rr',
  })
  // need original rate too for positions opened at issue — use rate on or before asOf
  await svc.addRate(admin, {
    rateSetId: 'rs2',
    orgId: 'org_verify_fx',
    rateId: 'rr0',
    fromCurrency: 'USD',
    rateDate: '2026-08-01',
    rateScaled: 1_850_000_000,
    source: 'manual',
    requestId: '12',
    idempotencyKey: 'rr0',
  })
  await svc.approveRateSet(admin, {
    rateSetId: 'rs2',
    orgId: 'org_verify_fx',
    approvalId: 'a2',
    reason: 'reval table',
    requestId: '13',
    idempotencyKey: 'ap2',
  })

  const reval = await svc.createRevaluation(admin, {
    id: 'rev',
    orgId: 'org_verify_fx',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    periodId: 'p1',
    asOfDate: '2026-08-31',
    rateSetId: 'rs2',
    reverseNextPeriod: true,
    reversePeriodId: 'p2',
    reversePostingDate: '2026-09-01',
    requestId: '14',
    idempotencyKey: 'rev',
  })
  assert.ok(reval.lines.some((l) => l.positionId === p2.id))
  assert.strictEqual(reval.journalProposal.balanced, true)
  assert.strictEqual(reval.reverseJournalProposal?.balanced, true)
  const approved = await svc.approveRevaluation(admin, {
    id: 'rev',
    orgId: 'org_verify_fx',
    approvalId: 'a3',
    reason: 'month end',
    requestId: '15',
    idempotencyKey: 'reva',
  })
  assert.strictEqual(approved.status, 'approved')
  const openPos = storeRef.current.positions.get(p2.id)!
  assert.ok(openPos.unrealizedFxMinor !== 0)
  assert.strictEqual(openPos.realizedFxMinor, 0)

  const list = await svc.listForOrg(admin, 'org_verify_fx')
  assert.strictEqual(list.noEgress, true)
  assert.strictEqual(list.externalPaymentInitiated, false)
  assert.strictEqual(list.sarsSubmissionInitiated, false)

  console.log(
    JSON.stringify(
      {
        ok: true,
        realizedFxMinor: settlement.realizedFxMinor,
        settlementBalanced: settlement.journalProposal.balanced,
        revalNetUnrealizedMinor: reval.netUnrealizedMinor,
        reverseNextPeriod: reval.reverseNextPeriod,
        openUnrealizedFxMinor: openPos.unrealizedFxMinor,
        noEgress: true,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
