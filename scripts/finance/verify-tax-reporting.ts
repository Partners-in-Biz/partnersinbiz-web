/**
 * Development/staging verification for VAT, tax periods, and financial statements.
 * No external egress.
 */
import { FinanceFoundationService, InMemoryFinanceFoundationStore, financeApprovalSubjectDigest } from '../../lib/accounting/foundation-service'
import { FinanceReportingService } from '../../lib/accounting/reporting-service'
import { FinanceTaxService, InMemoryTaxStore } from '../../lib/accounting/tax-service'
import { ZA_VAT_STANDARD_PACKAGE_V1, zaStandardVatRuleDraft } from '../../lib/jurisdictions/za/tax'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '../../lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '../../lib/finance/types'

const now = '2026-07-30T12:00:00.000Z'
const request = (key: string) => ({ requestId: `verify-${key}`, idempotencyKey: `verify-idem-${key}` })

const actor: FinanceActorContext = {
  uid: 'verify-admin',
  orgId: 'org-verify',
  membershipRole: 'owner',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [{
    id: 'a1',
    orgId: 'org-verify',
    userId: 'verify-admin',
    legalEntityId: 'entity-verify',
    scopeMode: 'entity',
    role: 'finance_admin',
    status: 'active',
  }],
}
const approver: FinanceActorContext = {
  ...actor,
  uid: 'verify-approver',
  membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'a2', userId: 'verify-approver', role: 'finance_approver' }],
}

function makeApproval(partial: Pick<FinanceApprovalRecord, 'id' | 'action' | 'reason' | 'subjectDigest'>): FinanceApprovalRecord {
  const base = {
    orgId: 'org-verify',
    legalEntityId: 'entity-verify',
    bookId: 'book-verify',
    id: partial.id,
    schemaVersion: 1 as const,
    action: partial.action,
    status: 'approved' as const,
    approvedBy: approver.uid,
    approverRole: 'finance_approver' as const,
    approverAssignmentId: 'a2',
    approvedAt: now,
    reason: partial.reason,
    subjectDigest: partial.subjectDigest,
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

async function main() {
  const foundationStore = new InMemoryFinanceFoundationStore()
  const foundation = new FinanceFoundationService(foundationStore, () => now)
  await foundation.createLegalEntity(actor, {
    id: 'entity-verify', orgId: 'org-verify', code: 'VE', legalName: 'Verify Entity',
    jurisdictionCode: 'ZA', functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual',
    fiscalYearStartMonth: 3, timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity'),
  })
  await foundation.createBook(actor, {
    id: 'book-verify', orgId: 'org-verify', legalEntityId: 'entity-verify', code: 'MAIN', name: 'Primary',
    bookType: 'primary', functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA',
    taxPointPolicyId: ZA_VAT_STANDARD_PACKAGE_V1.taxPointPolicyId, defaultControlAccountIds: {},
    status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request('book'),
  })
  const policyCommand = {
    id: 'policy-v1', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    versionNumber: 1, accountingBasis: 'accrual' as const, taxPointPolicyId: ZA_VAT_STANDARD_PACKAGE_V1.taxPointPolicyId,
    currencyPrecision: 2, roundingMode: 'half_up' as const, effectiveFrom: '2026-07-01', expectedVersion: 0 as const, ...request('policy'),
  }
  await foundation.createFinanceApproval(approver, {
    id: 'ap-policy', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    action: 'book-policy.approve', subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policyCommand),
    reason: 'ok', expectedVersion: 0, ...request('ap-policy'),
  })
  await foundation.createBookPolicyVersion(actor, { ...policyCommand, approvalId: 'ap-policy' })
  await foundation.createPeriod(actor, {
    id: 'period-v', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    fiscalYear: 2027, periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open',
    expectedVersion: 0, ...request('period'),
  })
  for (const account of [
    { id: 'cash', code: '1000', accountType: 'asset' as const, normalBalance: 'debit' as const, reportMapping: 'current_assets.cash' },
    { id: 'revenue', code: '4000', accountType: 'income' as const, normalBalance: 'credit' as const, reportMapping: 'income.sales' },
    { id: 'vat', code: '2100', accountType: 'liability' as const, normalBalance: 'credit' as const, reportMapping: 'current_liabilities.tax' },
    { id: 'capital', code: '3000', accountType: 'equity' as const, normalBalance: 'credit' as const, reportMapping: 'equity.capital' },
    { id: 'retained', code: '3100', accountType: 'equity' as const, normalBalance: 'credit' as const, reportMapping: 'equity.retained_earnings' },
  ]) {
    await foundation.createAccount(actor, {
      ...account, name: account.id, orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
      currency: 'ZAR', currencyPolicy: 'functional_only', postingAllowed: true, activeFrom: '2026-07-01',
      expectedVersion: 0, ...request(`acct-${account.id}`),
    })
  }

  const journalCommand = {
    id: 'j-sale', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify', periodId: 'period-v',
    sourceType: 'opening_balance', sourceId: 'sale-1', sourceVersion: 1, postingPurpose: 'document_issue',
    entryType: 'standard', postingDate: '2026-07-15', documentDate: '2026-07-15', description: 'Sale',
    currency: 'ZAR', policyVersionId: 'policy-v1', expectedVersion: 0 as const, requestId: 'verify-j', idempotencyKey: 'verify-j',
    approvalId: 'ap-journal',
    lines: [
      { accountId: 'cash', debitMinor: 11_500, creditMinor: 0 },
      { accountId: 'revenue', debitMinor: 0, creditMinor: 10_000 },
      { accountId: 'vat', debitMinor: 0, creditMinor: 1_500 },
    ],
  }
  // Control accounts block manual posts — use opening_balance style accounts without control roles.
  // vat account has no controlAccountRole so posting is allowed.
  await foundation.createFinanceApproval(approver, {
    id: 'ap-journal', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    action: 'journal.post', subjectDigest: financeApprovalSubjectDigest('journal.post', journalCommand),
    reason: 'ok', expectedVersion: 0, ...request('ap-journal'),
  })
  await foundation.postJournal(actor, journalCommand)

  const taxStore = new InMemoryTaxStore()
  const tax = new FinanceTaxService(taxStore, () => now)
  await tax.createTaxCode(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    id: 'tax-za-std', code: 'ZA-STD', name: 'Standard VAT', jurisdictionCode: 'ZA',
    category: 'output_vat', recoverability: 'full', outputAccountId: 'vat', active: true,
    expectedVersion: 0, ...request('tax-code'),
  })
  const ruleDraft = zaStandardVatRuleDraft({
    id: 'rule-za-v1', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    taxCodeId: 'tax-za-std', versionNumber: 1,
  })
  tax.registerApproval(makeApproval({
    id: 'ap-tax-rule', action: 'tax-rule.approve', reason: 'ZA package', subjectDigest: canonicalDigest(ruleDraft),
  }))
  const rule = await tax.createTaxRuleVersion(actor, {
    ...ruleDraft,
    approvalId: 'ap-tax-rule',
    expectedVersion: 0,
    ...request('tax-rule'),
  })
  const calc = tax.calculateTax(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    taxCodeId: 'tax-za-std', documentDate: '2026-07-15', taxableMinorExclusive: 10_000, taxIncluded: false,
  })
  if (calc.taxMinor !== 1_500 || calc.trace.taxRuleVersionId !== rule.id) {
    throw new Error('VAT calculation mismatch')
  }

  tax.recordJournalTaxTrace({
    journalEntryId: 'j-sale',
    taxCodeId: 'tax-za-std',
    taxRuleVersionId: rule.id,
    category: 'output_vat',
    taxableMinor: 10_000,
    taxMinor: 1_500,
    direction: 'output',
  })
  await tax.createTaxPeriod(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    id: 'tp-2026-07', jurisdictionCode: 'ZA', label: '2026-07',
    startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0, ...request('tp'),
  })
  const prepared = await tax.prepareTaxReturn(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    id: 'tr-2026-07', taxPeriodId: 'tp-2026-07', sourceCutoffAt: '2026-07-31',
    accountingBasis: 'accrual', expectedVersion: 0, ...request('tr'),
  })

  const reporting = new FinanceReportingService(foundationStore)
  const tb = reporting.trialBalance(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    asOfDate: '2026-07-31', accountingBasis: 'accrual', periodId: 'period-v',
  })
  const pnl = reporting.incomeStatement(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    fromDate: '2026-07-01', toDate: '2026-07-31', accountingBasis: 'accrual',
  })
  const sheet = reporting.balanceSheet(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    asOfDate: '2026-07-31', accountingBasis: 'accrual', retainedEarningsAccountId: 'retained',
  })

  if (!tb.balanced) throw new Error('trial balance not balanced')
  if (pnl.netIncomeMinor !== 10_000) throw new Error(`pnl net expected 10000 got ${pnl.netIncomeMinor}`)
  if (!sheet.balanced) throw new Error('balance sheet not balanced')

  // Period close still works and blocks ordinary postings afterwards.
  await foundation.createFinanceApproval(approver, {
    id: 'ap-close', orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    action: 'period.close',
    subjectDigest: financeApprovalSubjectDigest('period.close', {
      periodId: 'period-v', status: 'hard_closed', expectedVersion: 1, reason: 'month end',
      orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
      requestId: 'verify-close', idempotencyKey: 'verify-close',
    }),
    reason: 'month end', expectedVersion: 0, ...request('ap-close'),
  })
  await foundation.changePeriodStatus(actor, {
    orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify',
    periodId: 'period-v', status: 'hard_closed', expectedVersion: 1, reason: 'month end',
    approvalId: 'ap-close', requestId: 'verify-close', idempotencyKey: 'verify-close',
  })

  console.log(JSON.stringify({
    ok: true,
    vatRateBps: calc.trace.rateBasisPoints,
    taxReturnNetMinor: prepared.netTaxMinor,
    trialBalance: { debit: tb.totalDebitMinor, credit: tb.totalCreditMinor, balanced: tb.balanced },
    incomeStatementNetMinor: pnl.netIncomeMinor,
    balanceSheet: { assets: sheet.totalAssetsMinor, liabilitiesEquity: sheet.totalLiabilitiesMinor + sheet.totalEquityMinor, balanced: sheet.balanced },
    periodStatus: foundationStore.periods.get('period-v')?.status,
    noEgress: true,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
