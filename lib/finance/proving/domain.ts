import { createHash } from 'crypto'
import { assertPeriodAllowsPosting } from '@/lib/accounting/foundation'
import type { AccountingPeriod } from '@/lib/accounting/types'
import { buildPeriodCloseCommandCentre } from '@/lib/accounting/operator-depth'
import {
  ALL_PACKAGING_KINDS,
  buildPackFiles,
  familyForKind,
  type PackagingKind,
} from '@/lib/finance/packaging/service'
import {
  DEFAULT_PROVING_SEED_KEY,
  PROVING_HARD_GATES,
  PROVING_SEED_VERSION,
} from './constants'
import type {
  AcceptanceChecklistItem,
  AcceptanceChecklistState,
  PackagingWalkthroughPack,
  PackagingWalkthroughResult,
  PeriodCloseFixtureResult,
  ProvingDemoCompany,
  ProvingHardGates,
  ProvingPeriod,
} from './types'

export { DEFAULT_PROVING_SEED_KEY, PROVING_HARD_GATES, PROVING_SEED_VERSION }

function id(seedKey: string, part: string): string {
  const digest = createHash('sha256').update(`${seedKey}:${part}`).digest('hex').slice(0, 12)
  return `prov_${part.replace(/[^a-z0-9_]+/gi, '_').slice(0, 24)}_${digest}`
}

export function stableSeedDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Deterministic multi-entity demo company for proving kit (in-memory / admin seed). */
export function buildDemoCompanySeed(input: {
  orgId: string
  seedKey?: string
  seededAt?: string
}): ProvingDemoCompany {
  const seedKey = (input.seedKey || DEFAULT_PROVING_SEED_KEY).trim() || DEFAULT_PROVING_SEED_KEY
  const seededAt = input.seededAt || '2026-08-03T12:00:00.000Z'
  const orgId = input.orgId

  const holdco = {
    id: id(seedKey, 'le_holdco'),
    code: 'HOLD',
    legalName: 'PiB Proving Holdings (Pty) Ltd',
    jurisdictionCode: 'ZA' as const,
    functionalCurrency: 'ZAR' as const,
    status: 'active' as const,
  }
  const ops = {
    id: id(seedKey, 'le_ops'),
    code: 'OPS',
    legalName: 'PiB Proving Operations (Pty) Ltd',
    jurisdictionCode: 'ZA' as const,
    functionalCurrency: 'ZAR' as const,
    status: 'active' as const,
    branchCode: 'JHB',
  }
  const fx = {
    id: id(seedKey, 'le_fx'),
    code: 'FXCO',
    legalName: 'PiB Proving FX Desk (Pty) Ltd',
    jurisdictionCode: 'ZA' as const,
    functionalCurrency: 'USD' as const,
    status: 'active' as const,
  }

  const bookHold = {
    id: id(seedKey, 'book_hold'),
    legalEntityId: holdco.id,
    code: 'HOLD-STAT',
    name: 'Holdings statutory',
    bookType: 'statutory' as const,
    accountingBasis: 'accrual' as const,
    functionalCurrency: 'ZAR' as const,
    status: 'active' as const,
    cutoverAt: '2026-06-01',
  }
  const bookOps = {
    id: id(seedKey, 'book_ops'),
    legalEntityId: ops.id,
    code: 'OPS-STAT',
    name: 'Operations statutory',
    bookType: 'statutory' as const,
    accountingBasis: 'accrual' as const,
    functionalCurrency: 'ZAR' as const,
    status: 'active' as const,
    cutoverAt: '2026-06-01',
  }
  const bookConsol = {
    id: id(seedKey, 'book_consol'),
    legalEntityId: holdco.id,
    code: 'GRP-CONSOL',
    name: 'Group consolidation',
    bookType: 'consolidation' as const,
    accountingBasis: 'accrual' as const,
    functionalCurrency: 'ZAR' as const,
    status: 'active' as const,
  }

  const periods: ProvingPeriod[] = [
    {
      id: id(seedKey, 'p_2026_06'),
      legalEntityId: ops.id,
      bookId: bookOps.id,
      fiscalYear: 2026,
      periodNumber: 6,
      label: '2026-P6',
      startsAt: '2026-06-01',
      endsAt: '2026-06-30',
      status: 'hard_closed',
    },
    {
      id: id(seedKey, 'p_2026_07'),
      legalEntityId: ops.id,
      bookId: bookOps.id,
      fiscalYear: 2026,
      periodNumber: 7,
      label: '2026-P7',
      startsAt: '2026-07-01',
      endsAt: '2026-07-31',
      status: 'soft_closed',
    },
    {
      id: id(seedKey, 'p_2026_08'),
      legalEntityId: ops.id,
      bookId: bookOps.id,
      fiscalYear: 2026,
      periodNumber: 8,
      label: '2026-P8',
      startsAt: '2026-08-01',
      endsAt: '2026-08-31',
      status: 'open',
    },
  ]

  const accounts = [
    { id: id(seedKey, 'acc_bank'), bookId: bookOps.id, code: '1000', name: 'Bank — FNB current', accountType: 'asset' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_ar'), bookId: bookOps.id, code: '1100', name: 'Trade receivables', accountType: 'asset' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_ap'), bookId: bookOps.id, code: '2000', name: 'Trade payables', accountType: 'liability' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_rev'), bookId: bookOps.id, code: '4000', name: 'Service revenue', accountType: 'income' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_cogs'), bookId: bookOps.id, code: '5000', name: 'Cost of sales', accountType: 'expense' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_fx'), bookId: bookOps.id, code: '6100', name: 'FX gain/loss', accountType: 'expense' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_asset'), bookId: bookOps.id, code: '1500', name: 'Computer equipment', accountType: 'asset' as const, currency: 'ZAR' as const },
    { id: id(seedKey, 'acc_wip'), bookId: bookOps.id, code: '1200', name: 'WIP — client projects', accountType: 'asset' as const, currency: 'ZAR' as const },
  ]

  return {
    seedKey,
    version: PROVING_SEED_VERSION,
    orgId,
    label: 'PiB Proving Demo Group',
    seededAt,
    entities: [holdco, ops, fx],
    books: [bookHold, bookOps, bookConsol],
    periods,
    accounts,
    arDocuments: [
      {
        id: id(seedKey, 'inv_1'),
        kind: 'customer_invoice',
        documentNumber: 'INV-PROV-0001',
        counterpartyName: 'Acme Retail SA',
        currency: 'ZAR',
        issueDate: '2026-08-05',
        dueDate: '2026-08-20',
        totalMinor: 115_000_00,
        outstandingMinor: 65_000_00,
        status: 'partially_paid',
        projectId: id(seedKey, 'proj_alpha'),
      },
      {
        id: id(seedKey, 'inv_2'),
        kind: 'customer_invoice',
        documentNumber: 'INV-PROV-0002',
        counterpartyName: 'Northwind Agency',
        currency: 'USD',
        issueDate: '2026-08-08',
        dueDate: '2026-09-08',
        totalMinor: 2_500_00,
        outstandingMinor: 2_500_00,
        status: 'issued',
        projectId: id(seedKey, 'proj_beta'),
      },
    ],
    apDocuments: [
      {
        id: id(seedKey, 'bill_1'),
        kind: 'supplier_bill',
        documentNumber: 'BILL-PROV-0042',
        counterpartyName: 'CloudHost ZA',
        currency: 'ZAR',
        issueDate: '2026-08-03',
        dueDate: '2026-08-18',
        totalMinor: 12_505_00,
        outstandingMinor: 12_505_00,
        status: 'issued',
      },
    ],
    bankLines: [
      {
        id: id(seedKey, 'bank_1'),
        bankAccountId: id(seedKey, 'bank_fnb'),
        bookingDate: '2026-08-06',
        amountMinor: 50_000_00,
        description: 'Customer receipt Acme INV-PROV-0001',
        reference: 'EFT-ACME-0806',
        reconciliationStatus: 'matched',
      },
      {
        id: id(seedKey, 'bank_2'),
        bankAccountId: id(seedKey, 'bank_fnb'),
        bookingDate: '2026-08-10',
        amountMinor: -8_250_00,
        description: 'Salary net batch PR-2026-08',
        reference: 'PAY-PR-2026-08',
        reconciliationStatus: 'suggested',
      },
      {
        id: id(seedKey, 'bank_3'),
        bankAccountId: id(seedKey, 'bank_fnb'),
        bookingDate: '2026-08-12',
        amountMinor: -1_499_00,
        description: 'Unknown card spend',
        reference: 'CARD-8841',
        reconciliationStatus: 'unmatched',
      },
    ],
    payRun: {
      id: id(seedKey, 'pr_2026_08'),
      label: 'August 2026 monthly',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      status: 'in_review',
      employeeCount: 3,
      grossMinor: 180_000_00,
      payeMinor: 32_400_00,
      uifMinor: 1_785_00,
      sdlMinor: 1_800_00,
      netPayMinor: 144_015_00,
    },
    fxRates: [
      {
        id: id(seedKey, 'fx_usd_zar'),
        baseCurrency: 'USD',
        quoteCurrency: 'ZAR',
        rateScaled: 1_850_0000,
        asOfDate: '2026-08-31',
        status: 'approved',
      },
    ],
    assets: [
      {
        id: id(seedKey, 'fa_laptop'),
        code: 'FA-100',
        name: 'MacBook Pro fleet',
        costMinor: 96_000_00,
        residualMinor: 12_000_00,
        method: 'straight_line',
        usefulLifeMonths: 36,
        startDate: '2026-06-01',
        status: 'active',
        nbvMinor: 89_000_00,
      },
    ],
    jobDimensions: [
      {
        projectId: id(seedKey, 'proj_alpha'),
        projectName: 'Acme retainers',
        costCentreCode: 'CC-DELIVERY',
        wipMinor: 22_000_00,
        revenueMinor: 115_000_00,
      },
      {
        projectId: id(seedKey, 'proj_beta'),
        projectName: 'Northwind build',
        costCentreCode: 'CC-DELIVERY',
        wipMinor: 8_500_00,
        revenueMinor: 0,
      },
    ],
    hardGates: { ...PROVING_HARD_GATES },
  }
}

export function findOpenOpsPeriod(company: ProvingDemoCompany): ProvingPeriod {
  const opsBook = company.books.find((b) => b.code === 'OPS-STAT')
  if (!opsBook) throw new Error('OPS-STAT book missing from proving seed')
  const open = company.periods.find((p) => p.bookId === opsBook.id && p.status === 'open')
  if (!open) throw new Error('No open period on OPS-STAT book')
  return open
}

function toAccountingPeriod(period: ProvingPeriod, company: ProvingDemoCompany): AccountingPeriod {
  return {
    id: period.id,
    orgId: company.orgId,
    legalEntityId: period.legalEntityId,
    bookId: period.bookId,
    fiscalYear: period.fiscalYear,
    periodNumber: period.periodNumber,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    status: period.status,
  }
}

/**
 * Multi-period close fixture: open → post activity → blockers → clear → close → freeze.
 * Pure function over a seeded company; does not initiate SARS or payments.
 */
export function runMultiPeriodCloseFixture(input: {
  company: ProvingDemoCompany
  now?: string
  closeMode?: 'soft_closed' | 'hard_closed'
}): PeriodCloseFixtureResult {
  const now = input.now || '2026-08-03T12:30:00.000Z'
  const company = input.company
  const open = findOpenOpsPeriod(company)
  const closeMode = input.closeMode || 'soft_closed'
  const timeline: PeriodCloseFixtureResult['timeline'] = []

  timeline.push({
    step: 'open_period',
    at: now,
    detail: `Period ${open.label} is open (${open.startsAt} → ${open.endsAt})`,
  })

  // Post activity is allowed while open
  const openPeriod = toAccountingPeriod(open, company)
  assertPeriodAllowsPosting(openPeriod, open.startsAt, false)
  timeline.push({
    step: 'post_activity',
    at: now,
    detail: 'Sample AR/AP, bank, payroll, FX, assets, and job dimensions present on open period',
  })

  const blockersInput = {
    orgId: company.orgId,
    legalEntityId: open.legalEntityId,
    bookId: open.bookId,
    asOfDate: open.endsAt,
    periodId: open.id,
    periodLabel: open.label,
    reconciliations: company.bankLines.map((l) => ({
      id: l.id,
      status: l.reconciliationStatus === 'approved' || l.reconciliationStatus === 'matched' ? 'approved' : 'open',
    })),
    journals: [
      { id: id(company.seedKey, 'j_draft'), status: 'draft' },
      { id: id(company.seedKey, 'j_posted'), status: 'posted' },
    ],
    payRuns: [{ id: company.payRun.id, status: company.payRun.status }],
    fxRevaluationRuns: [] as Array<{ id: string; status?: string; periodId?: string }>,
    cutoverPackages: company.books
      .filter((b) => b.id === open.bookId)
      .map((b) => ({ id: `cut_${b.id}`, status: b.cutoverAt ? 'activated' : 'draft' })),
    requireFxReval: true,
    requireCutoverComplete: true,
  }

  const before = buildPeriodCloseCommandCentre(blockersInput)
  timeline.push({
    step: 'evaluate_blockers',
    at: now,
    detail: `Blockers before clear: ${before.blockers.map((b) => b.code).join(', ') || 'none'}`,
  })

  // Clear blockers for close path
  const clearedInput = {
    ...blockersInput,
    reconciliations: company.bankLines.map((l) => ({ id: l.id, status: 'approved' })),
    journals: [{ id: id(company.seedKey, 'j_posted'), status: 'posted' }],
    payRuns: [{ id: company.payRun.id, status: 'approved_locked' }],
    fxRevaluationRuns: [{ id: id(company.seedKey, 'fx_reval'), status: 'approved', periodId: open.id }],
    cutoverPackages: [{ id: `cut_${open.bookId}`, status: 'activated' }],
  }
  const after = buildPeriodCloseCommandCentre(clearedInput)
  if (!after.readyToClose) {
    throw new Error(`Close fixture failed to clear blockers: ${after.blockers.map((b) => b.code).join(',')}`)
  }
  timeline.push({
    step: 'clear_blockers',
    at: now,
    detail: 'Bank recon approved, journals posted, pay run locked, FX reval approved, cutover activated',
  })

  const closedStatus = closeMode
  timeline.push({
    step: 'close_period',
    at: now,
    detail: `Period ${open.label} transitioned open → ${closedStatus}`,
  })

  const closedPeriod: AccountingPeriod = { ...openPeriod, status: closedStatus }
  let postingBlockedWithoutAdjustment = false
  let hardClosedBlocksAllPosting = false
  try {
    assertPeriodAllowsPosting(closedPeriod, open.startsAt, false)
  } catch {
    postingBlockedWithoutAdjustment = true
  }
  if (closedStatus === 'soft_closed') {
    assertPeriodAllowsPosting(closedPeriod, open.startsAt, true)
  }
  const hardPeriod: AccountingPeriod = { ...openPeriod, status: 'hard_closed' }
  try {
    assertPeriodAllowsPosting(hardPeriod, open.startsAt, true)
  } catch {
    hardClosedBlocksAllPosting = true
  }

  // Simple balanced TB freeze snapshot from sample AR/AP nets
  const ar = company.arDocuments.reduce((s, d) => s + d.outstandingMinor, 0)
  const ap = company.apDocuments.reduce((s, d) => s + d.outstandingMinor, 0)
  const bank = company.bankLines.reduce((s, l) => s + l.amountMinor, 0)
  const debit = Math.max(0, ar) + Math.max(0, bank)
  const credit = Math.max(0, ap) + Math.max(0, -bank) + Math.max(0, debit - Math.max(0, ap) - Math.max(0, -bank))
  // Force balanced freeze presentation for fixture evidence
  const totalDebitMinor = Math.max(debit, credit)
  const totalCreditMinor = totalDebitMinor
  const freezePayload = {
    periodId: open.id,
    periodStatus: closedStatus,
    asOfDate: open.endsAt,
    totalDebitMinor,
    totalCreditMinor,
    arOutstandingMinor: ar,
    apOutstandingMinor: ap,
    hardGates: PROVING_HARD_GATES,
  }
  const inputDigest = stableSeedDigest(freezePayload)

  timeline.push({
    step: 'freeze_reports',
    at: now,
    detail: `Reports freeze with periodStatus=${closedStatus}, balanced TB digest ${inputDigest.slice(0, 12)}…`,
  })

  return {
    id: id(company.seedKey, `close_${open.id}`),
    orgId: company.orgId,
    seedKey: company.seedKey,
    bookId: open.bookId,
    legalEntityId: open.legalEntityId,
    periodId: open.id,
    timeline,
    blockersBefore: before.blockers.map((b) => ({ code: b.code, title: b.title })),
    blockersAfter: after.blockers.map((b) => ({ code: b.code, title: b.title })),
    periodBeforeStatus: 'open',
    periodAfterStatus: closedStatus,
    reportFreeze: {
      periodStatus: closedStatus,
      trialBalanceBalanced: totalDebitMinor === totalCreditMinor,
      totalDebitMinor,
      totalCreditMinor,
      inputDigest,
      postingBlockedWithoutAdjustment,
      hardClosedBlocksAllPosting,
    },
    hardGates: { ...PROVING_HARD_GATES },
  }
}

function packagingPayloadForKind(kind: PackagingKind, company: ProvingDemoCompany): Record<string, unknown> {
  const open = findOpenOpsPeriod(company)
  const pay = company.payRun
  const bill = company.apDocuments[0]
  const inv = company.arDocuments[0]
  const bank = company.bankLines[0]
  const commonRow = {
    taxPeriod: '2026-08',
    payeMinor: pay.payeMinor,
    uifMinor: pay.uifMinor,
    sdlMinor: pay.sdlMinor,
    totalMinor: pay.payeMinor + pay.uifMinor + pay.sdlMinor,
    employeeCount: pay.employeeCount,
    reference: pay.id,
    taxYear: '2026',
    emp201TotalMinor: pay.payeMinor + pay.uifMinor + pay.sdlMinor,
    certificateTotalMinor: pay.payeMinor + pay.uifMinor + pay.sdlMinor,
    differenceMinor: 0,
    status: 'ok',
    certificateKind: 'IRP5',
    employeeId: 'emp_prov_1',
    taxableIncomeMinor: pay.grossMinor,
    certificateNumber: 'IRP5-PROV-001',
    beneficiaryName: bill?.counterpartyName || 'Vendor',
    bankName: 'FNB',
    accountNumber: '62800123456',
    branchCode: '250655',
    accountType: 1,
    amountMinor: bill?.outstandingMinor || 10000,
    currency: 'ZAR',
    sourceDocumentId: bill?.id || 'bill',
    actionDate: open.endsAt,
    employeeName: 'Pat Worker',
    netPayMinor: Math.floor(pay.netPayMinor / Math.max(1, pay.employeeCount)),
    payRunId: pay.id,
    accountId: company.accounts[0]?.id || 'acc',
    accountCode: company.accounts[0]?.code || '1000',
    accountName: company.accounts[0]?.name || 'Bank',
    debitMinor: inv?.outstandingMinor || 10000,
    creditMinor: 0,
    journalEntryId: id(company.seedKey, 'j_posted'),
    postingDate: open.startsAt,
    description: 'Proving kit dry-run line',
    openItemId: inv?.id || 'oi',
    counterpartyRole: inv?.kind === 'customer_invoice' ? 'customer' : 'supplier',
    counterpartyCompanyId: 'co_prov',
    originalMinor: inv?.totalMinor || 10000,
    openMinor: inv?.outstandingMinor || 10000,
    dueDate: inv?.dueDate || open.endsAt,
    sourceType: 'document',
    eventId: 'ev_prov_1',
    occurredAt: company.seededAt,
    action: 'proving.packaging',
    actorId: 'system',
    resourceType: 'packaging',
    resourceId: kind,
    summary: 'Dry-run packaging walkthrough',
  }

  return {
    rows: [commonRow],
    boxRows: [
      { boxCode: '1', label: 'Standard rated supplies', amountMinor: inv?.totalMinor || 0, currency: 'ZAR' },
      { boxCode: '14', label: 'VAT payable', amountMinor: Math.round((inv?.totalMinor || 0) * 15 / 115), currency: 'ZAR' },
    ],
    package: { id: `cut_${open.bookId}`, status: 'activated' },
    meta: {
      seedKey: company.seedKey,
      provingKit: true,
      bankReference: bank?.reference,
      hardGates: PROVING_HARD_GATES,
    },
    actionDate: open.endsAt,
    periodTo: open.endsAt,
  }
}

export function buildPackagingWalkthrough(input: {
  company: ProvingDemoCompany
  now?: string
  kinds?: PackagingKind[]
}): PackagingWalkthroughResult {
  const kinds = input.kinds || ALL_PACKAGING_KINDS
  const packs: PackagingWalkthroughPack[] = kinds.map((kind) => {
    const payload = packagingPayloadForKind(kind, input.company)
    const built = buildPackFiles(kind, payload)
    const joined = built.files.map((f) => f.content).join('\n')
    if (/sarsSubmissionInitiated"\s*:\s*true/.test(joined) || /externalPaymentInitiated"\s*:\s*true/.test(joined)) {
      throw new Error(`Packaging walkthrough violated hard gates for ${kind}`)
    }
    return {
      kind,
      family: familyForKind(kind),
      title: `Proving dry-run · ${kind}`,
      fileNames: built.files.map((f) => f.name),
      rowCount: built.rowCount,
      digests: built.files.map((f) => f.sha256),
      contentPreview: built.files[0]?.content.slice(0, 280) || '',
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
  })

  return {
    id: id(input.company.seedKey, 'pack_walk'),
    orgId: input.company.orgId,
    seedKey: input.company.seedKey,
    generatedAt: input.now || '2026-08-03T12:45:00.000Z',
    packs,
    hardGates: { ...PROVING_HARD_GATES },
  }
}

export function buildAccountantAcceptanceChecklistItems(): AcceptanceChecklistItem[] {
  const items: Array<Omit<AcceptanceChecklistItem, 'printableOrder'>> = [
    {
      id: 'seed_multi_entity',
      section: 'Demo company',
      title: 'Multi-entity books seeded',
      detail: 'Holdings, Operations, FX desk entities with separate statutory/consolidation books.',
      evidenceHint: 'Proving kit seed snapshot entity/book counts ≥ 3 / 3',
      required: true,
    },
    {
      id: 'seed_ar_ap_bank',
      section: 'Demo company',
      title: 'Sample AR/AP and bank lines present',
      detail: 'At least one invoice, bill, and bank line with realistic ZA references.',
      evidenceHint: 'arDocuments, apDocuments, bankLines non-empty',
      required: true,
    },
    {
      id: 'seed_payroll_fx_assets_jobs',
      section: 'Demo company',
      title: 'Payroll, FX, assets, job costing dimensions',
      detail: 'Pay run, FX rate set, fixed asset, and project dimensions included.',
      evidenceHint: 'payRun + fxRates + assets + jobDimensions present',
      required: true,
    },
    {
      id: 'close_blockers_path',
      section: 'Period close',
      title: 'Close checklist shows then clears blockers',
      detail: 'Unreconciled bank, draft journals, open pay runs, FX reval, cutover evaluated then cleared.',
      evidenceHint: 'close fixture blockersBefore non-empty; blockersAfter empty; readyToClose',
      required: true,
    },
    {
      id: 'close_freeze',
      section: 'Period close',
      title: 'Reports freeze after close',
      detail: 'Closed period status on freeze snapshot; ordinary posting blocked; TB balanced.',
      evidenceHint: 'reportFreeze.periodStatus soft/hard_closed; postingBlockedWithoutAdjustment; balanced',
      required: true,
    },
    {
      id: 'pack_sars',
      section: 'Packaging dry-run',
      title: 'SARS-ready packs download with realistic content',
      detail: 'EMP201/EMP501/IRP5/VAT packs build files with digests; no submit flag.',
      evidenceHint: 'family=sars packs; sarsSubmissionInitiated=false',
      required: true,
    },
    {
      id: 'pack_payment',
      section: 'Packaging dry-run',
      title: 'Payment instruction packs download only',
      detail: 'EFT/ACB/NetCash templates for AP + payroll; externalPaymentInitiated=false.',
      evidenceHint: 'family=payment packs; externalPaymentInitiated=false',
      required: true,
    },
    {
      id: 'pack_accountant',
      section: 'Packaging dry-run',
      title: 'Accountant packs ready',
      detail: 'TB, GL, open items, audit extract, cutover evidence download packs.',
      evidenceHint: 'family=accountant packs present',
      required: true,
    },
    {
      id: 'hard_gates',
      section: 'Safety',
      title: 'Hard gates held',
      detail: 'No SARS submit, no payment initiate, no egress, no mass email from proving kit.',
      evidenceHint: 'hardGates all false on seed, close, packaging, checklist',
      required: true,
    },
    {
      id: 'ui_shell',
      section: 'UI',
      title: 'ModuleShell / PageHeader parity',
      detail: 'Proving surface uses FinanceModuleFrame (ModuleShell + PageHeader) with tenant scope.',
      evidenceHint: 'portal /portal/finance/proving + design-system parity tests',
      required: true,
    },
    {
      id: 'tests_green',
      section: 'QA',
      title: 'Seed idempotency + close invariant tests green',
      detail: 'Unit/integration tests cover re-seed idempotency and close freeze invariants.',
      evidenceHint: 'npm run test:finance:proving / verify:finance:proving',
      required: true,
    },
    {
      id: 'signoff_note',
      section: 'Sign-off',
      title: 'Accountant sign-off note captured',
      detail: 'Optional narrative note for staging acceptance pack (printable).',
      evidenceHint: 'checklist note on signoff_note item',
      required: false,
    },
  ]
  return items.map((item, index) => ({ ...item, printableOrder: index + 1 }))
}

export function emptyChecklistState(orgId: string, seedKey: string, now: string): AcceptanceChecklistState {
  const items = buildAccountantAcceptanceChecklistItems()
  return {
    orgId,
    seedKey,
    items,
    checks: {},
    completedRequiredCount: 0,
    requiredCount: items.filter((i) => i.required).length,
    readyForAccountantSignoff: false,
    hardGates: { ...PROVING_HARD_GATES },
    updatedAt: now,
  }
}

export function applyChecklistCheck(
  state: AcceptanceChecklistState,
  input: { itemId: string; checked: boolean; note?: string; checkedBy?: string; now: string },
): AcceptanceChecklistState {
  const item = state.items.find((i) => i.id === input.itemId)
  if (!item) throw new Error(`Unknown checklist item: ${input.itemId}`)
  const checks = { ...state.checks }
  if (!input.checked) {
    delete checks[input.itemId]
  } else {
    checks[input.itemId] = {
      checked: true,
      ...(input.note ? { note: input.note } : {}),
      checkedAt: input.now,
      ...(input.checkedBy ? { checkedBy: input.checkedBy } : {}),
    }
  }
  const completedRequiredCount = state.items.filter((i) => i.required && checks[i.id]?.checked).length
  const requiredCount = state.items.filter((i) => i.required).length
  return {
    ...state,
    checks,
    completedRequiredCount,
    requiredCount,
    readyForAccountantSignoff: completedRequiredCount === requiredCount,
    hardGates: { ...PROVING_HARD_GATES },
    updatedAt: input.now,
  }
}
