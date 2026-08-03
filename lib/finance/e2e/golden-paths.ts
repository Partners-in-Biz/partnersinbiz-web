/**
 * Finance golden-path runner used by Jest e2e + Playwright hermetic mode.
 * Development/staging verification only — no SARS submit, no external pay initiate.
 */
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { FinanceDocumentsService, InMemoryDocumentsStore } from '@/lib/accounting/documents-service'
import { ArApDepthService, InMemoryArApDepthStore } from '@/lib/accounting/ar-ap-depth-service'
import { immutableContentHash } from '@/lib/accounting/foundation'
import type { TaxCode, TaxRuleVersion } from '@/lib/accounting/tax-types'
import {
  BankRulesFinanceService,
  createEmptyBankRulesStore,
  type BankRulesStore,
} from '@/lib/finance/bank-rules/service'
import {
  PackagingFinanceService,
  createEmptyPackagingStore,
  type PackagingFinanceStore,
} from '@/lib/finance/packaging/service'
import { checkFinanceCommandOrgScope } from '@/lib/finance/http-guards'
import { PROVING_SEED_KEY } from '@/lib/finance/proving/demo-blueprint'
import { createInMemoryProvingService } from '@/lib/finance/proving/service'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'
import { FINANCE_NAV, FINANCE_PRIMARY_TABS, financeNavItem } from '@/components/finance/financeRoutes'
import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { FinancePayRunService } from '@/lib/payroll/pay-run-service'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

export type GoldenPathResult = {
  id: string
  title: string
  ok: boolean
  evidence: Record<string, unknown>
  hardGates: {
    sarsSubmissionInitiated: false
    externalPaymentInitiated: false
    autoPosted?: false
  }
}

export type GoldenPathReport = {
  ok: boolean
  generatedAt: string
  seedKey: string
  mode: 'hermetic'
  paths: GoldenPathResult[]
  hardGates: {
    sarsSubmissionInitiated: false
    externalPaymentInitiated: false
    noAutoPostBankRules: true
  }
}

const root = process.cwd()
const request = (key: string) => ({ requestId: `e2e-${key}`, idempotencyKey: `e2e-idem-${key}` })

function financeActor(
  orgId: string,
  uid = 'e2e-finance-admin',
  legalEntityId = 'entity-a',
): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'owner',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: `${uid}-asg`,
        orgId,
        userId: uid,
        legalEntityId,
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

function pageSource(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

function pathHub(): GoldenPathResult {
  const requiredPages = [
    'app/(portal)/portal/finance/page.tsx',
    'app/(portal)/portal/finance/documents/page.tsx',
    'app/(portal)/portal/finance/bank-rules/page.tsx',
    'app/(portal)/portal/finance/statements/page.tsx',
    'app/(portal)/portal/finance/payroll/page.tsx',
    'app/(portal)/portal/finance/packaging/page.tsx',
    'components/finance/FinanceScopeBar.tsx',
    'components/finance/FinanceModuleFrame.tsx',
  ]
  for (const rel of requiredPages) {
    if (!existsSync(path.join(root, rel))) {
      throw new Error(`missing finance surface ${rel}`)
    }
  }

  const hub = pageSource('app/(portal)/portal/finance/page.tsx')
  const scopeBar = pageSource('components/finance/FinanceScopeBar.tsx')
  const frame = pageSource('components/finance/FinanceModuleFrame.tsx')
  const deepLinkKeys = ['documents', 'bank-rules', 'payroll', 'packaging', 'statements', 'proving'] as const
  const deepLinks = deepLinkKeys.map((key) => financeNavItem(key).href)

  if (!hub.includes('FinanceHubCommandRail')) throw new Error('hub missing command rail')
  if (!hub.includes('No SARS')) throw new Error('hub missing SARS hard-gate copy')
  if (!hub.includes('scopedApiPath') && !hub.includes('X-Org-Id')) throw new Error('hub missing tenant helpers')
  if (!scopeBar.includes('data-testid="finance-scope-bar"')) throw new Error('scope bar missing test id')
  if (!frame.includes('No SARS submit')) throw new Error('frame missing SARS chip')
  if (!frame.includes('No external payment initiate')) throw new Error('frame missing payment chip')
  if (!FINANCE_PRIMARY_TABS.includes('hub')) throw new Error('primary tabs missing hub')
  if (FINANCE_NAV.length < 10) throw new Error('finance nav too thin')

  return {
    id: 'hub-scope-deeplinks',
    title: 'Finance hub loads with scope bar and deep links',
    ok: true,
    evidence: {
      scopeBarTestId: 'finance-scope-bar',
      deepLinks,
      primaryTabs: FINANCE_PRIMARY_TABS,
      navCount: FINANCE_NAV.length,
      hardGateChips: ['No SARS submit', 'No external payment initiate'],
    },
    hardGates: { sarsSubmissionInitiated: false, externalPaymentInitiated: false },
  }
}

async function pathArAp(): Promise<GoldenPathResult> {
  const now = '2026-07-30T10:00:00.000Z'
  const scope = { orgId: 'org-e2e-ar', legalEntityId: 'entity-a', bookId: 'book-a' }
  const actor = financeActor(scope.orgId)
  const docsStore = new InMemoryDocumentsStore()
  const docsService = new FinanceDocumentsService(docsStore, () => now)
  const depthStore = new InMemoryArApDepthStore()
  const depth = new ArApDepthService(docsStore, docsService, depthStore, () => now)

  const taxCode: TaxCode = {
    ...scope,
    id: 'tax-za-std',
    code: 'ZA-STD',
    name: 'Standard VAT',
    jurisdictionCode: 'ZA',
    category: 'output_vat',
    recoverability: 'full',
    active: true,
    schemaVersion: 1,
    version: 1,
    createdAt: now,
    createdBy: 'system',
    updatedAt: now,
    updatedBy: 'system',
  }
  const ruleBase = {
    ...scope,
    id: 'rule-za-std',
    taxCodeId: 'tax-za-std',
    jurisdictionCode: 'ZA',
    versionNumber: 1,
    rateBasisPoints: 1500,
    rateNumerator: 15,
    rateDenominator: 100,
    roundingMode: 'half_up' as const,
    taxPointPolicyId: 'za-invoice',
    effectiveFrom: '2026-07-01',
    status: 'approved' as const,
    sourceCitation: 'SARS VAT 15%',
    sourceChecksum: 'za-vat-15',
    immutable: true,
    schemaVersion: 1 as const,
    version: 1,
    createdAt: now,
    createdBy: 'system',
    updatedAt: now,
    updatedBy: 'system',
  }
  docsService.registerTaxCode(taxCode)
  docsService.registerTaxRule({ ...ruleBase, contentHash: immutableContentHash(ruleBase) } as TaxRuleVersion)

  const invoice = await docsService.createCustomerInvoice(actor, {
    ...scope,
    id: 'inv-e2e-1',
    customerCompanyId: 'cust-1',
    customerSnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd', vatNumber: '4123456789' },
    issueDate: '2026-07-10',
    dueDate: '2026-07-31',
    currency: 'ZAR',
    accountingBasis: 'accrual',
    lines: [
      {
        id: 'il1',
        description: 'Platform retainer',
        quantityMilli: 1000,
        unitPriceMinor: 10_000,
        taxCodeId: 'tax-za-std',
        taxIncluded: false,
        revenueOrExpenseAccountId: 'revenue',
      },
    ],
    expectedVersion: 0,
    ...request('inv-create'),
  })
  await docsService.issueCustomerInvoice(actor, {
    ...scope,
    invoiceId: invoice.id,
    expectedVersion: invoice.version,
    controlAccountId: 'ar',
    ...request('inv-issue'),
  })
  const receipt = await docsService.observePayment(actor, {
    ...scope,
    id: 'pay-e2e-1',
    direction: 'receipt',
    amountMinor: 5_000,
    currency: 'ZAR',
    observedDate: '2026-07-20',
    effectiveDate: '2026-07-20',
    method: 'eft',
    sourceEventKey: 'provider:e2e-1',
    counterpartyCompanyId: 'cust-1',
    expectedVersion: 0,
    ...request('pay'),
  })
  await docsService.allocatePayment(actor, {
    ...scope,
    id: 'alloc-e2e-1',
    paymentId: receipt.id,
    targetType: 'customer_invoice',
    targetId: invoice.id,
    allocatedMinor: 5_000,
    expectedVersion: 0,
    ...request('alloc'),
  })
  const credit = await depth.createCustomerCreditNote(actor, {
    ...scope,
    id: 'cn-e2e-1',
    customerCompanyId: 'cust-1',
    customerSnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd' },
    relatedInvoiceId: invoice.id,
    issueDate: '2026-07-22',
    currency: 'ZAR',
    accountingBasis: 'accrual',
    reason: 'Service credit',
    lines: [
      {
        id: 'cnl1',
        description: 'Goodwill credit',
        quantityMilli: 1000,
        unitPriceMinor: 1_500,
        taxCodeId: 'tax-za-std',
        taxIncluded: false,
        revenueOrExpenseAccountId: 'revenue',
      },
    ],
    expectedVersion: 0,
    ...request('cn-create'),
  })
  await depth.issueCustomerCreditNote(actor, {
    ...scope,
    creditNoteId: credit.id,
    expectedVersion: credit.version,
    ...request('cn-issue'),
  })
  await depth.applyCustomerCreditNote(actor, {
    ...scope,
    id: 'cna-e2e-1',
    creditNoteId: credit.id,
    invoiceId: invoice.id,
    appliedMinor: credit.totalMinor,
    expectedVersion: 0,
    ...request('cn-apply'),
  })

  const outstanding = docsStore.invoices.get(invoice.id)?.outstandingMinor
  if (outstanding !== 4_775) throw new Error(`unexpected outstanding ${outstanding}`)
  if (credit.massEmailAllowed !== false) throw new Error('credit note mass email must be false')

  return {
    id: 'ar-invoice-allocate-credit',
    title: 'Invoice → payment allocate → credit note',
    ok: true,
    evidence: {
      invoiceId: invoice.id,
      paymentId: receipt.id,
      creditNoteId: credit.id,
      outstandingMinor: outstanding,
      massEmailAllowed: false,
    },
    hardGates: { sarsSubmissionInitiated: false, externalPaymentInitiated: false },
  }
}

async function pathBankRules(): Promise<GoldenPathResult> {
  const orgId = 'org-e2e-bank'
  const legalEntityId = 'le_1'
  const actor = financeActor(orgId, 'e2e-finance-admin', legalEntityId)
  const storeRef = { current: createEmptyBankRulesStore() }
  const svc = new BankRulesFinanceService(
    async () => storeRef.current,
    async (_b, after: BankRulesStore) => {
      storeRef.current = after
    },
    () => '2026-08-03T12:00:00.000Z',
  )

  // Statement import analogue: unmatched bank transactions enter evaluation (human accept only).
  await svc.upsertRule(actor, {
    id: 'rule-e2e-rent',
    orgId,
    legalEntityId,
    bookId: 'book_1',
    name: 'Rent',
    priority: 1,
    match: { field: 'description', operator: 'contains', value: 'rent' },
    action: { kind: 'suggest_expense_account', accountId: 'acc_rent' },
    ...request('rule'),
  })
  const suggestions = await svc.evaluate(actor, {
    orgId,
    legalEntityId,
    bookId: 'book_1',
    bankAccountId: 'bank_main',
    bankTransactions: [
      { id: 'tx-rent', amountMinor: -25000, description: 'Office rent August', reconciliationState: 'unmatched' },
      { id: 'tx-other', amountMinor: 10000, description: 'Client paid', reconciliationState: 'unmatched' },
    ],
    ...request('eval'),
  })
  if (suggestions.length !== 1) throw new Error(`expected 1 suggestion, got ${suggestions.length}`)
  if (suggestions[0].status !== 'pending') throw new Error('suggestion must start pending')
  if (suggestions[0].autoPosted !== false) throw new Error('autoPosted must be false')

  const accepted = await svc.acceptSuggestion(actor, {
    id: suggestions[0].id,
    orgId,
    resolutionNote: 'Operator accepted (no auto-post)',
    ...request('accept'),
  })
  if (accepted.status !== 'accepted') throw new Error('accept failed')
  if (accepted.autoPosted !== false) throw new Error('accept must never auto-post')
  if (accepted.externalPaymentInitiated !== false) throw new Error('accept must not initiate payment')
  if (accepted.sarsSubmissionInitiated !== false) throw new Error('accept must not submit SARS')

  const bankRulesPage = pageSource('app/(portal)/portal/finance/bank-rules/page.tsx')
  if (!bankRulesPage.includes('Accept')) throw new Error('UI missing Accept control')
  if (!bankRulesPage.includes('never auto-posts')) throw new Error('UI missing never-auto-post copy')

  return {
    id: 'bank-rules-suggest-accept',
    title: 'Statement import + bank rule suggestion → human Accept (never auto-post)',
    ok: true,
    evidence: {
      suggestionId: accepted.id,
      status: accepted.status,
      autoPosted: accepted.autoPosted,
      unmatchedInputCount: 2,
      suggestedCount: 1,
    },
    hardGates: {
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      autoPosted: false,
    },
  }
}

async function pathPayrollLock(): Promise<GoldenPathResult> {
  const orgId = 'org-e2e-payroll'
  const scope = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }
  const actorFor = (uid: string, role: FinanceActorContext['assignments'][number]['role']): FinanceActorContext => ({
    uid,
    orgId,
    membershipRole: 'owner',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: `${uid}-a0`,
        orgId,
        userId: uid,
        legalEntityId: scope.legalEntityId,
        scopeMode: 'entity',
        role,
        status: 'active',
      },
    ],
  })
  const clerk = actorFor('clerk-1', 'payroll_clerk')
  const approver = actorFor('approver-1', 'payroll_approver')
  const approval = (id: string, action: FinanceApprovalRecord['action']): FinanceApprovalRecord => {
    const base = {
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      id,
      schemaVersion: 1 as const,
      action,
      status: 'approved' as const,
      approvedBy: 'external-approver',
      approverRole: 'payroll_approver' as const,
      approverAssignmentId: 'external-a0',
      approvedAt: '2026-03-21T10:00:00.000Z',
      reason: `Approve ${action}`,
      subjectDigest: canonicalDigest({ id, action }),
      immutable: true as const,
      canonicalPayloadVersion: 1 as const,
      hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    }
    return { ...base, contentHash: canonicalDigest(base) }
  }

  let now = '2026-03-19T10:00:00.000Z'
  const store = new InMemoryPayrollStore()
  const calcService = new FinancePayrollCalculationService(store, () => now)
  const employee = await calcService.createEmployee(clerk, {
    id: 'emp-1',
    ...scope,
    employeeNumber: 'E1',
    displayName: 'Ada Lovelace',
    taxResidency: 'za_resident',
    dateOfBirth: '1990-01-01',
    startDate: '2025-01-01',
    expectedVersion: 0,
    ...request('emp'),
  })
  const employment = await calcService.createEmployment(clerk, {
    id: 'empl-1',
    ...scope,
    employeeId: employee.id,
    expectedVersion: 0,
    ...request('empl'),
  })
  await calcService.createTermVersion(clerk, {
    id: 'term-1',
    ...scope,
    employeeId: employee.id,
    employmentId: employment.id,
    versionNumber: 1,
    workerCategory: 'salaried',
    frequency: 'monthly',
    rateMinor: 3_000_000,
    standardHoursPerPeriod: 160,
    overtimeMultiplierNumerator: 150,
    overtimeMultiplierDenominator: 100,
    subjectToUif: true,
    subjectToSdl: true,
    effectiveFrom: '2025-03-01',
    expectedVersion: 0,
    ...request('term'),
  })
  await calcService.createPayComponent(clerk, {
    id: 'cmp-bonus',
    ...scope,
    code: 'BONUS',
    name: 'Bonus',
    kind: 'bonus',
    taxTreatment: 'taxable',
    uifTreatment: 'include',
    sdlTreatment: 'include',
    jurisdictionCode: 'ZA',
    expectedVersion: 0,
    ...request('cmp'),
  })
  const draft = await calcService.createRuleVersion(clerk, {
    ...zaPayrollRuleVersionDraft({
      id: 'rule-1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      versionNumber: 1,
    }),
    ...scope,
    expectedVersion: 0,
    ...request('rule'),
  })
  calcService.registerApproval(approval('ap-rule', 'payroll.rule.approve'))
  const rule = await calcService.approveRuleVersion(approver, {
    ...scope,
    ruleVersionId: draft.id,
    expectedVersion: draft.version,
    approvalId: 'ap-rule',
    reason: 'tables',
    ...request('rule-ap'),
  })
  const calendar = await calcService.createCalendar(clerk, {
    id: 'cal-1',
    ...scope,
    code: 'M',
    name: 'Monthly',
    frequency: 'monthly',
    expectedVersion: 0,
    ...request('cal'),
  })
  const period = await calcService.createPayPeriod(clerk, {
    id: 'per-1',
    ...scope,
    calendarId: calendar.id,
    label: '2026-03',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    payDate: '2026-03-25',
    cutOffAt: '2026-03-20T12:00:00.000Z',
    taxYearLabel: '2025/26',
    expectedVersion: 0,
    ...request('per'),
  })
  const calculation = await calcService.calculateEmployee(clerk, {
    id: 'calc-1',
    ...scope,
    employeeId: employee.id,
    employmentId: employment.id,
    termVersionId: 'term-1',
    payPeriodId: period.id,
    ruleVersionId: rule.id,
    components: [{ componentCode: 'BONUS', quantityMinorUnits: 1, unitAmountMinor: 100_000 }],
    expectedVersion: 0,
    ...request('calc'),
  })

  const payRunService = new FinancePayRunService(store, () => now)
  const run = await payRunService.createPayRun(clerk, {
    id: 'run-e2e-1',
    ...scope,
    calendarId: calendar.id,
    payPeriodId: period.id,
    ruleVersionId: rule.id,
    label: 'E2E March 2026',
    expectedVersion: 0,
    ...request('run'),
  })
  let withItem = await payRunService.addItem(clerk, {
    id: 'item-1',
    ...scope,
    payRunId: run.id,
    calculationId: calculation.id,
    expectedVersion: run.version,
    ...request('item'),
  })
  now = '2026-03-21T09:00:00.000Z'
  withItem = await payRunService.freezeInputs(clerk, {
    ...scope,
    payRunId: withItem.id,
    expectedVersion: withItem.version,
    ...request('freeze'),
  })
  const submitted = await payRunService.submitForReview(clerk, {
    ...scope,
    payRunId: withItem.id,
    expectedVersion: withItem.version,
    ...request('submit'),
  })
  payRunService.registerApproval(approval('ap-run', 'payroll.run.approve'))
  const locked = await payRunService.approveAndLock(approver, {
    ...scope,
    payRunId: submitted.id,
    expectedVersion: submitted.version,
    approvalId: 'ap-run',
    reason: 'E2E approved lock',
    ...request('approve'),
  })

  if (locked.status !== 'approved_locked') throw new Error(`expected approved_locked, got ${locked.status}`)
  if (locked.externalPaymentInitiated !== false) throw new Error('pay run must not initiate external payment')
  if (locked.sarsSubmissionInitiated !== false) throw new Error('pay run must not submit SARS')

  return {
    id: 'payroll-approve-lock',
    title: 'Payroll run approve/lock (no external pay)',
    ok: true,
    evidence: {
      payRunId: locked.id,
      status: locked.status,
      payslipCount: locked.payslipIds?.length ?? 0,
      externalPaymentInitiated: locked.externalPaymentInitiated,
      sarsSubmissionInitiated: locked.sarsSubmissionInitiated,
    },
    hardGates: { sarsSubmissionInitiated: false, externalPaymentInitiated: false },
  }
}

async function pathPackaging(): Promise<GoldenPathResult> {
  const orgId = 'org-e2e-pack'
  const legalEntityId = 'le_1'
  const actor = financeActor(orgId, 'e2e-finance-admin', legalEntityId)
  const storeRef = { current: createEmptyPackagingStore() }
  const svc = new PackagingFinanceService(
    async () => storeRef.current,
    async (_b, after: PackagingFinanceStore) => {
      storeRef.current = after
    },
    () => '2026-08-03T12:00:00.000Z',
  )

  const pack = await svc.createPack(actor, {
    id: 'pack-e2e-emp201',
    orgId,
    legalEntityId,
    bookId: 'book_1',
    kind: 'sars.emp201',
    title: 'E2E EMP201',
    currency: 'ZAR',
    payload: {
      rows: [
        {
          taxPeriod: '2026-07',
          payeMinor: 1200000,
          uifMinor: 45000,
          sdlMinor: 30000,
          totalMinor: 1275000,
          employeeCount: 12,
          reference: 'EMP201-2026-07',
        },
      ],
    },
    ...request('pack-create'),
  })
  if (!pack.files?.length) throw new Error('pack must return downloadable files')
  if (pack.sarsSubmissionInitiated || pack.externalPaymentInitiated || pack.externalEgressAllowed) {
    throw new Error('pack hard gates failed on create')
  }
  const downloaded = await svc.markDownloaded(actor, {
    id: pack.id,
    orgId,
    ...request('pack-dl'),
  })
  if (downloaded.status !== 'downloaded') throw new Error('download mark failed')
  if (downloaded.sarsSubmissionInitiated || downloaded.externalPaymentInitiated || downloaded.externalEgressAllowed) {
    throw new Error('pack hard gates failed on download')
  }

  // Proving kit packaging dry-run also produces multi-pack evidence.
  const proving = createInMemoryProvingService(() => '2026-08-03T12:00:00.000Z')
  const provingActor = financeActor('org-e2e-proving')
  await proving.seedDemoCompany(provingActor, {
    orgId: provingActor.orgId,
    seedKey: PROVING_SEED_KEY,
    ...request('seed'),
  })
  const dry = await proving.packagingDryRun(provingActor, { orgId: provingActor.orgId, ...request('packs') })
  if (dry.packs.length < 11) throw new Error('proving packaging dry-run too thin')
  for (const p of dry.packs) {
    if (p.sarsSubmissionInitiated || p.externalPaymentInitiated || p.externalEgressAllowed) {
      throw new Error(`proving pack hard gate failed: ${p.kind}`)
    }
    if (!p.fileNames?.length) throw new Error(`proving pack missing files: ${p.kind}`)
  }

  return {
    id: 'packaging-download',
    title: 'Packaging download packs return files',
    ok: true,
    evidence: {
      packId: downloaded.id,
      fileCount: downloaded.files.length,
      fileNames: downloaded.files.map((f) => f.name),
      provingPackCount: dry.packs.length,
      seedKey: PROVING_SEED_KEY,
    },
    hardGates: { sarsSubmissionInitiated: false, externalPaymentInitiated: false },
  }
}

async function pathTenantIsolation(): Promise<GoldenPathResult> {
  const mismatch = checkFinanceCommandOrgScope('org-a', 'org-b')
  if (mismatch.ok || mismatch.status !== 403 || mismatch.error !== 'Organization scope mismatch') {
    throw new Error('org scope guard failed mismatch case')
  }
  const missing = checkFinanceCommandOrgScope(undefined, 'org-a')
  if (missing.ok || missing.status !== 422) throw new Error('org scope guard failed missing orgId')
  const ok = checkFinanceCommandOrgScope('org-a', 'org-a')
  if (!ok.ok) throw new Error('org scope guard failed match case')

  const orgId = 'org-e2e-tenant'
  const legalEntityId = 'le_1'
  const actor = financeActor(orgId, 'e2e-finance-admin', legalEntityId)
  const wrongActor = financeActor('org-other', 'intruder', legalEntityId)
  const storeRef = { current: createEmptyBankRulesStore() }
  const svc = new BankRulesFinanceService(
    async () => storeRef.current,
    async (_b, after: BankRulesStore) => {
      storeRef.current = after
    },
    () => '2026-08-03T12:00:00.000Z',
  )
  await svc.upsertRule(actor, {
    id: 'rule-tenant',
    orgId,
    legalEntityId,
    bookId: 'book_1',
    name: 'Tenant rule',
    priority: 1,
    match: { field: 'description', operator: 'contains', value: 'x' },
    action: { kind: 'suggest_expense_account', accountId: 'acc_x' },
    ...request('tenant-rule'),
  })
  let denied = false
  try {
    await svc.upsertRule(wrongActor, {
      id: 'rule-evil',
      orgId,
      legalEntityId,
      bookId: 'book_1',
      name: 'Evil',
      priority: 1,
      match: { field: 'description', operator: 'contains', value: 'x' },
      action: { kind: 'suggest_expense_account', accountId: 'acc_x' },
      ...request('tenant-evil'),
    })
  } catch {
    denied = true
  }
  if (!denied) throw new Error('wrong-org actor was allowed to mutate bank rules')

  return {
    id: 'tenant-isolation',
    title: 'Tenant isolation smoke (wrong org denied)',
    ok: true,
    evidence: {
      httpGuardMismatch: mismatch,
      serviceWrongOrgDenied: true,
    },
    hardGates: { sarsSubmissionInitiated: false, externalPaymentInitiated: false },
  }
}

export async function runFinanceGoldenPaths(): Promise<GoldenPathReport> {
  const paths: GoldenPathResult[] = []
  paths.push(pathHub())
  paths.push(await pathArAp())
  paths.push(await pathBankRules())
  paths.push(await pathPayrollLock())
  paths.push(await pathPackaging())
  paths.push(await pathTenantIsolation())

  const ok = paths.every((p) => p.ok)
  return {
    ok,
    generatedAt: new Date().toISOString(),
    seedKey: PROVING_SEED_KEY,
    mode: 'hermetic',
    paths,
    hardGates: {
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      noAutoPostBankRules: true,
    },
  }
}
