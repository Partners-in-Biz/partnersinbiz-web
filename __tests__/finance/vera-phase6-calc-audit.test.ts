import {
  BANK_AGING_GOLDENS,
  BANK_SAFE_BULK_GOLDENS,
  EXPENSE_GL_GOLDEN_CASES,
  REVREC_MULTI_PERIOD_GOLDEN,
  REVREC_REMAINDER_GOLDEN,
  VERA_PHASE6_AUDIT_META,
  runAllVeraPhase6Goldens,
  runBankFeedMaterializationGolden,
  runExpenseGlGolden,
  runRevRecMultiPeriodGolden,
} from '@/lib/finance/audit/vera-phase6-golden-fixtures'
import { agingBucketForDays, isSafeBulkAcceptSuggestion } from '@/lib/finance/bank-feeds/productization'
import { runAllVeraPhase45Goldens } from '@/lib/finance/audit/vera-phase45-golden-fixtures'

describe('Vera Phase 6 calc + recon audit goldens', () => {
  test('meta pins hard gates closed', () => {
    expect(VERA_PHASE6_AUDIT_META.hardGates).toEqual({
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      autoPosted: false,
      externalEgressAllowed: false,
      noEgress: true,
    })
    expect(VERA_PHASE6_AUDIT_META.taskId).toBe('pSz1QwT7wC6Q98og327J')
  })

  test('phase 4+5 golden pack still variance=0', () => {
    const summary = runAllVeraPhase45Goldens()
    expect(summary.failCount).toBe(0)
    expect(summary.passCount).toBe(summary.results.length)
    expect(summary.packageMatches2025_26Tables).toBe(true)
  })

  test.each([...EXPENSE_GL_GOLDEN_CASES])('expense→GL golden $id', (c) => {
    const run = runExpenseGlGolden(c)
    expect(run.pass).toBe(true)
    expect(run.variance).toBe(0)
    expect(run.proposal.balanced).toBe(true)
    expect(run.debit).toBe(run.credit)
    expect(run.debit).toBe(c.expected.grossTotalMinor)
    expect(run.hardGates.externalPaymentInitiated).toBe(false)
    expect(run.hardGates.autoPosted).toBe(false)
  })

  test('revenue recognition multi-period postings + reverse', async () => {
    const rev = await runRevRecMultiPeriodGolden()
    expect(rev.pass).toBe(true)
    expect(rev.pureOk).toBe(true)
    expect(rev.remainderOk).toBe(true)
    expect(rev.periodResults).toHaveLength(3)
    for (const p of rev.periodResults) {
      expect(p.recognizedMinor).toBe(REVREC_MULTI_PERIOD_GOLDEN.expectedPerPeriodMinor)
      expect(p.journalBalanced).toBe(true)
    }
    expect(rev.finalBeforeReverse.recognizedMinor).toBe(REVREC_MULTI_PERIOD_GOLDEN.totalContractMinor)
    expect(rev.finalBeforeReverse.deferredBalanceMinor).toBe(0)
    expect(rev.afterReverse.recognizedMinor).toBe(8_000_00)
    expect(rev.afterReverse.deferredBalanceMinor).toBe(4_000_00)
    expect(rev.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(rev.hardGates.externalPaymentInitiated).toBe(false)
  })

  test.each([...BANK_SAFE_BULK_GOLDENS])('bank safe-bulk pure $id', (g) => {
    expect(isSafeBulkAcceptSuggestion(g.suggestion)).toBe(g.expectedSafe)
  })

  test.each([...BANK_AGING_GOLDENS])('bank aging pure $id', (g) => {
    expect(agingBucketForDays(g.days)).toBe(g.expected)
  })

  test('bank feed materialization → recon suggestions integrity (mock)', async () => {
    const bf = await runBankFeedMaterializationGolden()
    expect(bf.pass).toBe(true)
    expect(bf.variance).toBe(0)
    expect(bf.lineCount).toBeGreaterThanOrEqual(8)
    expect(bf.suggestionCount).toBe(bf.lineCount)
    expect(bf.uniqueFingerprints).toBe(bf.lineCount)
    expect(bf.idempotentSecondSyncLines).toBe(0)
    expect(bf.hardGates.autoPosted).toBe(false)
    expect(bf.hardGates.externalPaymentInitiated).toBe(false)
    expect(bf.hardGates.noEgress).toBe(true)
    expect(bf.hasSars).toBe(true)
    expect(bf.sarsStatus).toBe('pending')
    expect(bf.fileImportFallback).toBe('/portal/finance/statements')
  })

  test('aggregate runner: all phase6 goldens pass', async () => {
    const summary = await runAllVeraPhase6Goldens()
    expect(summary.failCount).toBe(0)
    expect(summary.passCount).toBe(summary.results.length)
    expect(summary.phase45.failCount).toBe(0)
    expect(summary.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(summary.hardGates.externalPaymentInitiated).toBe(false)
    expect(summary.hardGates.autoPosted).toBe(false)
    // predecessor HIGH findings still documented
    expect(summary.materialFindings.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        'PAYROLL_TAX_YEAR_PACKAGE_GAP',
        'VAT_RETURN_TRACE_NOT_PERIOD_SCOPED',
        'EXPENSE_POST_IS_PROPOSAL_NOT_LEDGER_JOURNAL',
        'BANK_SUGGESTIONS_RULE_HEURISTIC',
      ]),
    )
    for (const row of summary.results) {
      expect(row.pass).toBe(true)
    }
  })
})
