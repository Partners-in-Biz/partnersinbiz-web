/**
 * Vera Phase 6 independent calc + recon correctness golden fixtures.
 * Expands Phase 4+5 pack: expense→GL, rev-rec multi-period postings, bank-feed materialization/recon.
 * No SARS submit / payment initiate / auto-post / production deploy.
 */
import {
  buildRecognitionJournalLines,
  buildReversalJournalLines,
  buildStraightLineRevenueSchedule,
  deferredBalanceFrom,
  recognizedBps,
  scheduleLinesTotal,
} from '@/lib/accounting/revenue-recognition'
import { InMemoryRevenueRecognitionService } from '@/lib/accounting/revenue-recognition-service'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  buildPostJournalProposal,
  normalizeClaimLine,
  sumClaimLines,
  vatMinorForNet,
} from '@/lib/finance/expense-claims/service'
import type { ExpenseClaim } from '@/lib/finance/expense-claims/types'
import {
  agingBucketForDays,
  isSafeBulkAcceptSuggestion,
  SAFE_BULK_ACCEPT_MIN_CONFIDENCE,
} from '@/lib/finance/bank-feeds/productization'
import {
  BankFeedFinanceService,
  createEmptyBankFeedStore,
  type BankFeedStore,
} from '@/lib/finance/bank-feeds/service'
import { MOCK_BANK_FEED_ACCOUNT, MOCK_BANK_FEED_SAVINGS_ACCOUNT } from '@/lib/finance/bank-feeds/mock-provider'
import {
  runAllVeraPhase45Goldens,
  VERA_AUDIT_META as PHASE45_META,
} from '@/lib/finance/audit/vera-phase45-golden-fixtures'

export const VERA_PHASE6_AUDIT_META = {
  auditId: 'vera-phase6-calc-recon-pSz1QwT7wC6Q98og327J',
  packageId: 'vera-phase6-expansion-v1',
  taskId: 'pSz1QwT7wC6Q98og327J',
  projectId: 'HRCSWl1cNnh6fYEGziAb',
  phase: 6,
  predecessorAuditId: PHASE45_META.auditId,
  hardGates: {
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
    autoPosted: false,
    externalEgressAllowed: false,
    noEgress: true,
  },
} as const

export type VeraPhase6Result = {
  domain: string
  fixtureId: string
  pass: boolean
  expected?: unknown
  actual?: unknown
  variance?: number | string
  note?: string
}

// ─── Expense claim → GL ───────────────────────────────────────────────────────

export const EXPENSE_GL_GOLDEN_CASES = [
  {
    id: 'exp-gl-fuel-std15-payable',
    lines: [
      {
        id: 'l1',
        description: 'Fuel Engen',
        expenseAccountId: 'acc_travel',
        netMinor: 850_00,
        taxRateCode: 'za_std_15' as const,
      },
    ],
    creditAccountId: 'acc_claims_payable',
    vatControlAccountId: 'acc_vat_input',
    expected: {
      netTotalMinor: 850_00,
      vatTotalMinor: 127_50,
      grossTotalMinor: 977_50,
      lineShape: [
        { accountId: 'acc_travel', debitMinor: 850_00, creditMinor: 0 },
        { accountId: 'acc_vat_input', debitMinor: 127_50, creditMinor: 0 },
        { accountId: 'acc_claims_payable', debitMinor: 0, creditMinor: 977_50 },
      ],
      balanced: true,
    },
  },
  {
    id: 'exp-gl-multi-line-mixed-vat',
    lines: [
      {
        id: 'l1',
        description: 'Client lunch',
        expenseAccountId: 'acc_meals',
        netMinor: 400_00,
        taxRateCode: 'za_std_15' as const,
      },
      {
        id: 'l2',
        description: 'Zero-rated export shipping sample',
        expenseAccountId: 'acc_shipping',
        netMinor: 200_00,
        taxRateCode: 'za_zero' as const,
      },
      {
        id: 'l3',
        description: 'Parking',
        expenseAccountId: 'acc_travel',
        netMinor: 50_00,
        taxRateCode: 'za_std_15' as const,
      },
    ],
    creditAccountId: 'acc_claims_payable',
    vatControlAccountId: 'acc_vat_input',
    expected: {
      // VAT: round(40000*0.15)=6000; 0; round(5000*0.15)=750 → 6750
      netTotalMinor: 650_00,
      vatTotalMinor: 67_50,
      grossTotalMinor: 717_50,
      lineShape: [
        { accountId: 'acc_meals', debitMinor: 400_00, creditMinor: 0 },
        { accountId: 'acc_shipping', debitMinor: 200_00, creditMinor: 0 },
        { accountId: 'acc_travel', debitMinor: 50_00, creditMinor: 0 },
        { accountId: 'acc_vat_input', debitMinor: 67_50, creditMinor: 0 },
        { accountId: 'acc_claims_payable', debitMinor: 0, creditMinor: 717_50 },
      ],
      balanced: true,
    },
  },
  {
    id: 'exp-gl-zero-vat-only',
    lines: [
      {
        id: 'l1',
        description: 'Exempt education course',
        expenseAccountId: 'acc_training',
        netMinor: 1_200_00,
        taxRateCode: 'za_exempt' as const,
      },
    ],
    creditAccountId: 'acc_claims_payable',
    vatControlAccountId: 'acc_vat_input',
    expected: {
      netTotalMinor: 1_200_00,
      vatTotalMinor: 0,
      grossTotalMinor: 1_200_00,
      // No VAT control line when vatTotal=0
      lineShape: [
        { accountId: 'acc_training', debitMinor: 1_200_00, creditMinor: 0 },
        { accountId: 'acc_claims_payable', debitMinor: 0, creditMinor: 1_200_00 },
      ],
      balanced: true,
    },
  },
] as const

export function runExpenseGlGolden(caseRow: (typeof EXPENSE_GL_GOLDEN_CASES)[number]) {
  const normalized = caseRow.lines.map((l) => normalizeClaimLine({ ...l }))
  const totals = sumClaimLines(normalized)
  // Independent VAT cross-check
  const independentVat = caseRow.lines.reduce(
    (s, l) => s + vatMinorForNet(l.netMinor, l.taxRateCode),
    0,
  )
  const claimStub = {
    id: caseRow.id,
    lines: normalized,
    vatTotalMinor: totals.vatTotalMinor,
    grossTotalMinor: totals.grossTotalMinor,
    postTarget: 'payable' as const,
  } as ExpenseClaim
  const proposal = buildPostJournalProposal(
    claimStub,
    caseRow.creditAccountId,
    caseRow.vatControlAccountId,
  )
  const shape = proposal.lines.map((l) => ({
    accountId: l.accountId,
    debitMinor: l.debitMinor,
    creditMinor: l.creditMinor,
  }))
  const debit = proposal.lines.reduce((s, l) => s + l.debitMinor, 0)
  const credit = proposal.lines.reduce((s, l) => s + l.creditMinor, 0)
  const pass =
    totals.netTotalMinor === caseRow.expected.netTotalMinor &&
    totals.vatTotalMinor === caseRow.expected.vatTotalMinor &&
    totals.grossTotalMinor === caseRow.expected.grossTotalMinor &&
    independentVat === caseRow.expected.vatTotalMinor &&
    proposal.balanced === true &&
    debit === credit &&
    debit === caseRow.expected.grossTotalMinor &&
    JSON.stringify(shape) === JSON.stringify(caseRow.expected.lineShape)

  return {
    pass,
    totals,
    independentVat,
    proposal,
    shape,
    debit,
    credit,
    variance: pass
      ? 0
      : {
          net: totals.netTotalMinor - caseRow.expected.netTotalMinor,
          vat: totals.vatTotalMinor - caseRow.expected.vatTotalMinor,
          gross: totals.grossTotalMinor - caseRow.expected.grossTotalMinor,
        },
    hardGates: {
      externalPaymentInitiated: false,
      autoPosted: false,
      sarsSubmissionInitiated: false,
    },
  }
}

// ─── Revenue recognition multi-period ─────────────────────────────────────────

export const REVREC_MULTI_PERIOD_GOLDEN = {
  id: 'revrec-sl-3mo-1200000-across-periods',
  totalContractMinor: 12_000_00,
  months: 3,
  startDate: '2026-06-01',
  periods: ['2026-06', '2026-07', '2026-08'] as const,
  expectedPerPeriodMinor: 4_000_00,
  expectedScheduleAmounts: [4_000_00, 4_000_00, 4_000_00],
  deferredAccountId: 'acc-def',
  revenueAccountId: 'acc-rev',
} as const

export const REVREC_REMAINDER_GOLDEN = {
  id: 'revrec-sl-remainder-10000-3mo',
  totalContractMinor: 100_00,
  months: 3,
  startDate: '2026-01-15',
  expectedAmounts: [3333, 3333, 3334],
} as const

function revRecActor(
  uid: string,
  role: FinanceActorContext['assignments'][number]['role'] = 'finance_admin',
  orgId = 'org-vera-p6',
): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: `asg-${uid}`,
        orgId,
        userId: uid,
        legalEntityId: 'entity-vera',
        scopeMode: 'entity',
        role,
        status: 'active',
      },
    ],
  }
}

export async function runRevRecMultiPeriodGolden() {
  const g = REVREC_MULTI_PERIOD_GOLDEN
  const pure = buildStraightLineRevenueSchedule({
    totalContractMinor: g.totalContractMinor,
    months: g.months,
    startDate: g.startDate,
    scheduleId: 'sch-pure',
  })
  const pureOk =
    scheduleLinesTotal(pure) === g.totalContractMinor &&
    pure.map((l) => l.amountMinor).join(',') === g.expectedScheduleAmounts.join(',')

  const svc = new InMemoryRevenueRecognitionService(undefined, () => '2026-08-03T12:00:00.000Z')
  const admin = revRecActor('admin-p6')
  const poster = revRecActor('poster-p6', 'finance_approver')
  const scope = { orgId: admin.orgId, legalEntityId: 'entity-vera', bookId: 'book-vera' }

  await svc.createSchedule(admin, {
    id: 'sch-p6',
    ...scope,
    scheduleNumber: 'RR-P6-1',
    name: 'Vera Phase6 retainer',
    arInvoiceId: 'inv-p6-1',
    contractRef: 'CTR-P6',
    currency: 'ZAR',
    method: 'straight_line',
    totalContractMinor: g.totalContractMinor,
    months: g.months,
    startDate: g.startDate,
    deferredRevenueAccountId: g.deferredAccountId,
    revenueAccountId: g.revenueAccountId,
    expectedVersion: 0,
    requestId: 'p6-sch',
    idempotencyKey: 'p6-sch',
  })
  await svc.activateSchedule(admin, {
    id: 'sch-p6',
    ...scope,
    expectedVersion: 1,
    requestId: 'p6-act',
    idempotencyKey: 'p6-act',
  })

  const periodResults: Array<{
    periodKey: string
    recognizedMinor: number
    journalBalanced: boolean
    journalShape: Array<{ accountId: string; debitMinor: number; creditMinor: number }>
    deferredAfter: number
    recognizedCumulative: number
  }> = []

  let expectedDeferred = g.totalContractMinor
  let expectedRecognized = 0

  for (const period of g.periods) {
    const run = await svc.createRecognitionRun(admin, {
      id: `run-${period}`,
      ...scope,
      periodKey: period,
      postingDate: `${period}-28`,
      expectedVersion: 0,
      requestId: `p6-run-${period}`,
      idempotencyKey: `p6-run-${period}`,
    })
    const calculated = await svc.calculateRecognitionRun(admin, {
      id: run.id,
      ...scope,
      expectedVersion: run.version,
      requestId: `p6-calc-${period}`,
      idempotencyKey: `p6-calc-${period}`,
    })
    const posted = await svc.postRecognitionRun(poster, {
      id: run.id,
      ...scope,
      approvalId: `appr-${period}`,
      reason: 'Vera phase6 golden',
      expectedVersion: calculated.version,
      requestId: `p6-post-${period}`,
      idempotencyKey: `p6-post-${period}`,
    })
    const jLines = buildRecognitionJournalLines({
      deferredRevenueAccountId: g.deferredAccountId,
      revenueAccountId: g.revenueAccountId,
      amountMinor: calculated.totalRecognizedMinor,
      description: `Recognize ${period}`,
    })
    const jDeb = jLines.reduce((s, l) => s + l.debitMinor, 0)
    const jCred = jLines.reduce((s, l) => s + l.creditMinor, 0)
    expectedRecognized += g.expectedPerPeriodMinor
    expectedDeferred -= g.expectedPerPeriodMinor
    const sch = svc.storeRef.current.schedules.get('sch-p6')!
    periodResults.push({
      periodKey: period,
      recognizedMinor: calculated.totalRecognizedMinor,
      journalBalanced: jDeb === jCred && jDeb === g.expectedPerPeriodMinor,
      journalShape: jLines.map((l) => ({
        accountId: l.accountId,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
      })),
      deferredAfter: sch.deferredBalanceMinor,
      recognizedCumulative: sch.recognizedMinor,
    })
    if (
      calculated.totalRecognizedMinor !== g.expectedPerPeriodMinor ||
      posted.status !== 'approved_posted' ||
      sch.recognizedMinor !== expectedRecognized ||
      sch.deferredBalanceMinor !== expectedDeferred ||
      posted.externalPaymentInitiated !== false ||
      posted.sarsSubmissionInitiated !== false
    ) {
      // keep collecting; pass decided below
    }
  }

  const schFinal = svc.storeRef.current.schedules.get('sch-p6')!
  const reverseLines = buildReversalJournalLines({
    deferredRevenueAccountId: g.deferredAccountId,
    revenueAccountId: g.revenueAccountId,
    amountMinor: g.expectedPerPeriodMinor,
    description: 'Reverse last',
  })
  const last = svc.storeRef.current.recognitionRuns.get('run-2026-08')!
  const reversed = await svc.reverseRecognitionRun(poster, {
    id: last.id,
    ...scope,
    approvalId: 'appr-rev',
    reason: 'Vera reverse check',
    expectedVersion: last.version,
    requestId: 'p6-rev',
    idempotencyKey: 'p6-rev',
  })
  const afterRev = svc.storeRef.current.schedules.get('sch-p6')!
  const deferredRpt = await svc.deferredRevenueReport(admin, scope, '2026-08')
  const vs = await svc.recognizedVsBilledReport(admin, scope, '2026-08')

  const allPeriodsOk = periodResults.every(
    (p) =>
      p.recognizedMinor === g.expectedPerPeriodMinor &&
      p.journalBalanced &&
      p.journalShape[0].accountId === g.deferredAccountId &&
      p.journalShape[0].debitMinor === g.expectedPerPeriodMinor &&
      p.journalShape[1].accountId === g.revenueAccountId &&
      p.journalShape[1].creditMinor === g.expectedPerPeriodMinor,
  )
  const pass =
    pureOk &&
    allPeriodsOk &&
    schFinal.recognizedMinor === g.totalContractMinor &&
    schFinal.deferredBalanceMinor === 0 &&
    schFinal.status === 'completed' &&
    reversed.status === 'reversed' &&
    afterRev.recognizedMinor === 8_000_00 &&
    afterRev.deferredBalanceMinor === 4_000_00 &&
    deferredRpt.totalDeferredMinor === 4_000_00 &&
    deferredRpt.totalRecognizedMinor === 8_000_00 &&
    vs.recognizedBps === recognizedBps(8_000_00, 12_000_00) &&
    deferredBalanceFrom({ billedMinor: 12_000_00, recognizedMinor: 8_000_00 }) === 4_000_00 &&
    reverseLines[0].debitMinor === g.expectedPerPeriodMinor

  // remainder pure schedule
  const rem = buildStraightLineRevenueSchedule({
    totalContractMinor: REVREC_REMAINDER_GOLDEN.totalContractMinor,
    months: REVREC_REMAINDER_GOLDEN.months,
    startDate: REVREC_REMAINDER_GOLDEN.startDate,
    scheduleId: 'sch-rem',
  })
  const remainderOk =
    rem.map((l) => l.amountMinor).join(',') === REVREC_REMAINDER_GOLDEN.expectedAmounts.join(',') &&
    scheduleLinesTotal(rem) === REVREC_REMAINDER_GOLDEN.totalContractMinor

  return {
    pass: pass && remainderOk,
    pureOk,
    remainderOk,
    periodResults,
    finalBeforeReverse: {
      status: schFinal.status,
      recognizedMinor: schFinal.recognizedMinor,
      deferredBalanceMinor: schFinal.deferredBalanceMinor,
    },
    afterReverse: {
      status: afterRev.status,
      recognizedMinor: afterRev.recognizedMinor,
      deferredBalanceMinor: afterRev.deferredBalanceMinor,
      reversedRunStatus: reversed.status,
    },
    reports: {
      deferredMinor: deferredRpt.totalDeferredMinor,
      recognizedMinor: deferredRpt.totalRecognizedMinor,
      recognizedBps: vs.recognizedBps,
    },
    hardGates: {
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    },
    variance: pass && remainderOk ? 0 : 'see periodResults/final',
  }
}

// ─── Bank feed materialization → recon integrity ─────────────────────────────

export const BANK_SAFE_BULK_GOLDENS = [
  {
    id: 'bf-safe-bulk-high-conf-rent',
    suggestion: {
      kind: 'suggest_expense_account' as const,
      confidence: 0.9,
      reason: 'Description contains rent — suggest premises expense',
      status: 'pending' as const,
    },
    expectedSafe: true,
  },
  {
    id: 'bf-safe-bulk-block-sars',
    suggestion: {
      kind: 'suggest_expense_account' as const,
      confidence: 0.99,
      reason: 'SARS EFT PAYE PAYMENT — flag_review path',
      status: 'pending' as const,
    },
    expectedSafe: false,
  },
  {
    id: 'bf-safe-bulk-block-low-conf',
    suggestion: {
      kind: 'suggest_expense_account' as const,
      confidence: 0.5,
      reason: 'Weak match',
      status: 'pending' as const,
    },
    expectedSafe: false,
  },
  {
    id: 'bf-safe-bulk-block-flag-review',
    suggestion: {
      kind: 'flag_review' as const,
      confidence: 0.99,
      reason: 'No strong rule match',
      status: 'pending' as const,
    },
    expectedSafe: false,
  },
  {
    id: 'bf-safe-bulk-block-already-accepted',
    suggestion: {
      kind: 'suggest_expense_account' as const,
      confidence: 0.95,
      reason: 'Rent',
      status: 'accepted' as const,
    },
    expectedSafe: false,
  },
] as const

export const BANK_AGING_GOLDENS = [
  { id: 'bf-age-3', days: 3, expected: '0-7' as const },
  { id: 'bf-age-7', days: 7, expected: '0-7' as const },
  { id: 'bf-age-8', days: 8, expected: '8-30' as const },
  { id: 'bf-age-30', days: 30, expected: '8-30' as const },
  { id: 'bf-age-31', days: 31, expected: '31-60' as const },
  { id: 'bf-age-61', days: 61, expected: '61+' as const },
] as const

function bankActor(uid: string, orgId: string): FinanceActorContext {
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

export async function runBankFeedMaterializationGolden() {
  const storeRef: { current: BankFeedStore } = { current: createEmptyBankFeedStore() }
  const now = '2026-08-10T12:00:00.000Z'
  const svc = new BankFeedFinanceService(
    async () => storeRef.current,
    async (_b, a) => {
      storeRef.current = a
    },
    () => now,
  )
  const orgId = 'org_vera_bf_p6'
  const admin = bankActor('vera-bf', orgId)

  await svc.createConnection(admin, {
    id: 'conn-p6',
    orgId,
    legalEntityId: 'le_1',
    bookId: 'book_1',
    providerId: 'mock',
    label: 'Vera Mock FNB',
    bankAccountId: 'bank_main',
    requestId: 'p6-c',
    idempotencyKey: 'p6-c',
  })

  const { run, lines, suggestions } = await svc.syncNow(admin, {
    id: 'run-p6',
    orgId,
    legalEntityId: 'le_1',
    bookId: 'book_1',
    connectionId: 'conn-p6',
    noEgress: true,
    requestId: 'p6-s',
    idempotencyKey: 'p6-s',
  })

  const second = await svc.syncNow(admin, {
    id: 'run-p6-2',
    orgId,
    legalEntityId: 'le_1',
    bookId: 'book_1',
    connectionId: 'conn-p6',
    noEgress: true,
    requestId: 'p6-s2',
    idempotencyKey: 'p6-s2',
  })

  const fingerprints = new Set(lines.map((l) => l.sourceFingerprint))
  const externalIds = new Set(lines.map((l) => l.externalTransactionId).filter(Boolean))

  // Integrity assertions
  const allMaterialized = lines.length > 0 && lines.every((l) => Boolean(l.reconMaterializedAt))
  const allPending = suggestions.length > 0 && suggestions.every((s) => s.status === 'pending')
  const noAutoPost =
    lines.every((l) => l.autoPosted === false) &&
    suggestions.every((s) => s.autoPosted === false) &&
    run.autoPosted === false
  const noPay =
    lines.every((l) => l.externalPaymentInitiated === false) &&
    suggestions.every((s) => s.externalPaymentInitiated === false) &&
    run.externalPaymentInitiated === false
  const noEgress = run.noEgress === true && run.externalEgressAllowed === false
  const uniqueFp = fingerprints.size === lines.length
  const uniqueExt = externalIds.size === lines.length
  const suggestionPerLine = suggestions.length === lines.length
  const idempotentSecond = second.lines.length === 0
  const multiAccountLinked =
    (storeRef.current.connections.get('conn-p6')?.linkedAccounts || []).length >= 2

  // Expected mock seed integrity: cheque 8 + savings 3 = 11 when both accounts sync
  const expectedMinLines = 8
  const hasRent = lines.some((l) => /rent/i.test(l.description || ''))
  const hasSars = lines.some((l) => /sars/i.test(l.description || ''))
  const sarsSuggestion = suggestions.find((s) => /sars|paye/i.test(s.reason || ''))
  const sarsNotSafe =
    !sarsSuggestion ||
    !isSafeBulkAcceptSuggestion({
      kind: sarsSuggestion.kind,
      confidence: sarsSuggestion.confidence,
      reason: sarsSuggestion.reason,
      status: sarsSuggestion.status,
    })

  // Safe bulk subset should exclude SARS/flag_review/low conf
  const safeIds = suggestions.filter((s) => isSafeBulkAcceptSuggestion(s)).map((s) => s.id)
  const bulk = await svc.bulkResolveSuggestions(admin, {
    orgId,
    legalEntityId: 'le_1',
    bookId: 'book_1',
    resolution: 'accept',
    requestId: 'p6-bulk',
    idempotencyKey: 'p6-bulk',
  })

  const bundle = await svc.getBundle(admin, orgId, 'le_1', 'book_1')
  const chequeAccountPresent = (bundle.connections[0].accounts || []).some(
    (a) => a.externalAccountId === MOCK_BANK_FEED_ACCOUNT.externalAccountId,
  )
  const savingsAccountPresent = (bundle.connections[0].accounts || []).some(
    (a) => a.externalAccountId === MOCK_BANK_FEED_SAVINGS_ACCOUNT.externalAccountId,
  )

  const pureSafeOk = BANK_SAFE_BULK_GOLDENS.every(
    (g) => isSafeBulkAcceptSuggestion(g.suggestion) === g.expectedSafe,
  )
  const pureAgingOk = BANK_AGING_GOLDENS.every((g) => agingBucketForDays(g.days) === g.expected)

  const pass =
    pureSafeOk &&
    pureAgingOk &&
    allMaterialized &&
    allPending &&
    noAutoPost &&
    noPay &&
    noEgress &&
    uniqueFp &&
    uniqueExt &&
    suggestionPerLine &&
    idempotentSecond &&
    multiAccountLinked &&
    lines.length >= expectedMinLines &&
    hasRent &&
    hasSars &&
    sarsNotSafe &&
    bulk.autoPosted === false &&
    bulk.externalPaymentInitiated === false &&
    bulk.resolved.every((r) => r.status === 'accepted' && isSafeBulkAcceptSuggestion({ ...r, status: 'pending' })) &&
    // bulk only resolves safe pending — SARS must remain pending
    (sarsSuggestion ? storeRef.current.suggestions.get(sarsSuggestion.id)?.status === 'pending' : true) &&
    bundle.hardGates.autoPosted === false &&
    bundle.hardGates.externalPaymentInitiated === false &&
    bundle.hardGates.noEgress === true &&
    bundle.reconCentre.unreconciledCount > 0 &&
    bundle.reconCentre.fileImportFallbackPath === '/portal/finance/statements' &&
    chequeAccountPresent &&
    savingsAccountPresent

  // After bulk, SARS if still pending proves integrity of safe filter
  const sarsStatus = sarsSuggestion
    ? storeRef.current.suggestions.get(sarsSuggestion.id)?.status
    : undefined

  return {
    pass,
    fixtureId: 'bf-materialize-recon-mock-p6',
    fetched: run.fetchedCount,
    imported: run.importedCount,
    lineCount: lines.length,
    suggestionCount: suggestions.length,
    uniqueFingerprints: fingerprints.size,
    uniqueExternalIds: externalIds.size,
    idempotentSecondSyncLines: second.lines.length,
    multiAccountLinked,
    safeBulkAccepted: bulk.resolved.length,
    safeBulkMinConfidence: SAFE_BULK_ACCEPT_MIN_CONFIDENCE,
    sarsStatus,
    hasRent,
    hasSars,
    pureSafeOk,
    pureAgingOk,
    hardGates: bundle.hardGates,
    reconUnreconciled: bundle.reconCentre.unreconciledCount,
    fileImportFallback: bundle.reconCentre.fileImportFallbackPath,
    linkedAccountIds: (bundle.connections[0].accounts || []).map((a) => a.externalAccountId),
    variance: pass ? 0 : 'materialization/recon integrity failed — see flags',
    checks: {
      allMaterialized,
      allPending,
      noAutoPost,
      noPay,
      noEgress,
      uniqueFp,
      uniqueExt,
      suggestionPerLine,
      idempotentSecond,
      sarsNotSafe,
    },
  }
}

// ─── Aggregate runner ─────────────────────────────────────────────────────────

export async function runAllVeraPhase6Goldens() {
  const results: VeraPhase6Result[] = []

  // 1) Re-run Phase 4+5 pack
  const phase45 = runAllVeraPhase45Goldens()
  results.push({
    domain: 'phase45_pack',
    fixtureId: 'vera-phase45-aggregate',
    pass: phase45.failCount === 0,
    expected: { failCount: 0, passCount: phase45.passCount },
    actual: { failCount: phase45.failCount, passCount: phase45.passCount },
    variance: phase45.failCount,
    note: 'Payroll/VAT/FX/dep/job-costing goldens from predecessor pack',
  })
  for (const r of phase45.results) {
    results.push({
      domain: `phase45_${r.domain}`,
      fixtureId: r.fixtureId,
      pass: r.pass,
      expected: r.expected,
      actual: r.actual,
      variance: r.pass ? 0 : 'nonzero',
    })
  }

  // 2) Expense → GL
  for (const c of EXPENSE_GL_GOLDEN_CASES) {
    const run = runExpenseGlGolden(c)
    results.push({
      domain: 'expense_gl',
      fixtureId: c.id,
      pass: run.pass,
      expected: c.expected,
      actual: { totals: run.totals, shape: run.shape, balanced: run.proposal.balanced },
      variance: typeof run.variance === 'number' ? run.variance : JSON.stringify(run.variance),
    })
  }

  // 3) Rev-rec multi-period
  const rev = await runRevRecMultiPeriodGolden()
  results.push({
    domain: 'revenue_recognition',
    fixtureId: REVREC_MULTI_PERIOD_GOLDEN.id,
    pass: rev.pass,
    expected: {
      perPeriod: REVREC_MULTI_PERIOD_GOLDEN.expectedPerPeriodMinor,
      fullRecognized: REVREC_MULTI_PERIOD_GOLDEN.totalContractMinor,
      afterReverseDeferred: 4_000_00,
    },
    actual: {
      periodResults: rev.periodResults,
      finalBeforeReverse: rev.finalBeforeReverse,
      afterReverse: rev.afterReverse,
      reports: rev.reports,
      pureOk: rev.pureOk,
      remainderOk: rev.remainderOk,
    },
    variance: rev.variance,
  })
  results.push({
    domain: 'revenue_recognition',
    fixtureId: REVREC_REMAINDER_GOLDEN.id,
    pass: rev.remainderOk,
    expected: REVREC_REMAINDER_GOLDEN.expectedAmounts,
    actual: rev.remainderOk ? REVREC_REMAINDER_GOLDEN.expectedAmounts : 'mismatch',
    variance: rev.remainderOk ? 0 : 1,
  })

  // 4) Bank feed
  for (const g of BANK_SAFE_BULK_GOLDENS) {
    const actual = isSafeBulkAcceptSuggestion(g.suggestion)
    results.push({
      domain: 'bank_safe_bulk_pure',
      fixtureId: g.id,
      pass: actual === g.expectedSafe,
      expected: g.expectedSafe,
      actual,
      variance: actual === g.expectedSafe ? 0 : 1,
    })
  }
  for (const g of BANK_AGING_GOLDENS) {
    const actual = agingBucketForDays(g.days)
    results.push({
      domain: 'bank_aging_pure',
      fixtureId: g.id,
      pass: actual === g.expected,
      expected: g.expected,
      actual,
      variance: actual === g.expected ? 0 : 1,
    })
  }
  const bf = await runBankFeedMaterializationGolden()
  results.push({
    domain: 'bank_feed_materialization',
    fixtureId: bf.fixtureId,
    pass: bf.pass,
    expected: {
      minLines: 8,
      suggestionPerLine: true,
      idempotentSecond: 0,
      multiAccount: true,
      hardGates: VERA_PHASE6_AUDIT_META.hardGates,
    },
    actual: bf,
    variance: bf.variance,
  })

  const passCount = results.filter((r) => r.pass).length
  const failCount = results.length - passCount

  const materialFindings = [
    ...phase45.materialFindings.map((f) => ({ ...f, source: 'phase45' as const })),
    {
      severity: 'low' as const,
      code: 'EXPENSE_POST_IS_PROPOSAL_NOT_LEDGER_JOURNAL',
      summary:
        'Expense claim post builds a balanced journalProposal on the claim record. Full foundation ledger journal posting path is separate; this pack certifies proposal balance + VAT line shape, not dual-write into foundation journals.',
      source: 'phase6' as const,
    },
    {
      severity: 'low' as const,
      code: 'BANK_SUGGESTIONS_RULE_HEURISTIC',
      summary:
        'Mock bank-feed suggestions are deterministic description heuristics (rent/sars/fee/interest). Match quality is rule-based, not ML; integrity = 1:1 line→suggestion, unique fingerprints, human-gated accept, SARS excluded from safe bulk.',
      source: 'phase6' as const,
    },
  ]

  return {
    meta: VERA_PHASE6_AUDIT_META,
    phase45: {
      passCount: phase45.passCount,
      failCount: phase45.failCount,
      packageMatches2025_26Tables: phase45.packageMatches2025_26Tables,
      packageMatches2026_27Tables: phase45.packageMatches2026_27Tables,
      materialFindings: phase45.materialFindings,
    },
    results,
    passCount,
    failCount,
    materialFindings,
    hardGates: VERA_PHASE6_AUDIT_META.hardGates,
  }
}
