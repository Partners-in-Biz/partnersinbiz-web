import { createHash } from 'crypto'
import type {
  AcceptanceCheckItem,
  CloseBlocker,
  DemoArApLine,
  DemoAsset,
  DemoBankLine,
  DemoFxPosition,
  DemoJobCost,
  DemoPayrollRun,
  ProvingEntityBlueprint,
  ProvingPeriodKey,
  ReportFreezeSnapshot,
} from './types'

export const PROVING_SEED_KEY = 'pib-demo-proving-v1'
export const PROVING_COMPANY_NAME = 'PiB Proving Holdings (Pty) Ltd'

export const PROVING_PERIODS: ProvingPeriodKey[] = ['2026-05', '2026-06', '2026-07']

export function periodBounds(periodKey: ProvingPeriodKey): {
  startsAt: string
  endsAt: string
  fiscalYear: number
  periodNumber: number
} {
  const map: Record<
    ProvingPeriodKey,
    { startsAt: string; endsAt: string; fiscalYear: number; periodNumber: number }
  > = {
    '2026-05': { startsAt: '2026-05-01', endsAt: '2026-05-31', fiscalYear: 2027, periodNumber: 3 },
    '2026-06': { startsAt: '2026-06-01', endsAt: '2026-06-30', fiscalYear: 2027, periodNumber: 4 },
    '2026-07': { startsAt: '2026-07-01', endsAt: '2026-07-31', fiscalYear: 2027, periodNumber: 5 },
  }
  return map[periodKey]
}

export function stableOrgPrefix(orgId: string): string {
  const digest = createHash('sha256').update(orgId).digest('hex').slice(0, 8)
  return `prv_${digest}`
}

export function buildDemoEntities(orgId: string): ProvingEntityBlueprint[] {
  const prefix = stableOrgPrefix(orgId)
  return [
    {
      id: `${prefix}_le_holdco`,
      code: 'HOLD',
      legalName: 'PiB Proving Holdings (Pty) Ltd',
      bookId: `${prefix}_book_hold_main`,
      bookCode: 'HOLD-MAIN',
      branchId: `${prefix}_br_hold_hq`,
      branchCode: 'HQ',
      functionalCurrency: 'ZAR',
    },
    {
      id: `${prefix}_le_ops`,
      code: 'OPS',
      legalName: 'PiB Proving Operations (Pty) Ltd',
      bookId: `${prefix}_book_ops_main`,
      bookCode: 'OPS-MAIN',
      branchId: `${prefix}_br_ops_jhb`,
      branchCode: 'JHB',
      functionalCurrency: 'ZAR',
    },
    {
      id: `${prefix}_le_svc`,
      code: 'SVC',
      legalName: 'PiB Proving Services (Pty) Ltd',
      bookId: `${prefix}_book_svc_main`,
      bookCode: 'SVC-MAIN',
      branchId: `${prefix}_br_svc_cpt`,
      branchCode: 'CPT',
      functionalCurrency: 'ZAR',
    },
  ]
}

export function buildDemoArAp(entities: ProvingEntityBlueprint[]): DemoArApLine[] {
  const hold = entities[0]
  const ops = entities[1]
  const svc = entities[2]
  return [
    {
      id: 'ar_ops_acme_1001',
      entityId: ops.id,
      role: 'customer',
      counterpartyName: 'Acme Retail SA',
      documentNumber: 'INV-1001',
      originalMinor: 11_500_000,
      openMinor: 5_750_000,
      dueDate: '2026-07-15',
      currency: 'ZAR',
      projectId: 'proj_ops_rollout',
    },
    {
      id: 'ar_svc_globex_2001',
      entityId: svc.id,
      role: 'customer',
      counterpartyName: 'Globex Consulting LLC',
      documentNumber: 'INV-USD-2001',
      originalMinor: 1_250_000,
      openMinor: 1_250_000,
      dueDate: '2026-08-01',
      currency: 'USD',
      projectId: 'proj_svc_retainers',
    },
    {
      id: 'ap_ops_supplies_9001',
      entityId: ops.id,
      role: 'supplier',
      counterpartyName: 'Office Depot ZA',
      documentNumber: 'BILL-9001',
      originalMinor: 2_300_000,
      openMinor: 2_300_000,
      dueDate: '2026-07-20',
      currency: 'ZAR',
    },
    {
      id: 'ap_hold_audit_9101',
      entityId: hold.id,
      role: 'supplier',
      counterpartyName: 'Independent Auditors Inc',
      documentNumber: 'BILL-9101',
      originalMinor: 8_500_000,
      openMinor: 0,
      dueDate: '2026-06-30',
      currency: 'ZAR',
    },
  ]
}

export function buildDemoBankLines(entities: ProvingEntityBlueprint[]): DemoBankLine[] {
  const ops = entities[1]
  return [
    {
      id: 'bank_ops_1',
      entityId: ops.id,
      bookingDate: '2026-07-05',
      description: 'Customer receipt INV-1001 partial',
      amountMinor: 5_750_000,
      currency: 'ZAR',
      matched: true,
    },
    {
      id: 'bank_ops_2',
      entityId: ops.id,
      bookingDate: '2026-07-18',
      description: 'Unmatched card fee',
      amountMinor: -45_000,
      currency: 'ZAR',
      matched: false,
    },
    {
      id: 'bank_ops_3',
      entityId: ops.id,
      bookingDate: '2026-07-22',
      description: 'Supplier payment BILL-9001 pending match',
      amountMinor: -2_300_000,
      currency: 'ZAR',
      matched: false,
    },
  ]
}

export function buildDemoPayroll(entities: ProvingEntityBlueprint[]): DemoPayrollRun[] {
  const ops = entities[1]
  const svc = entities[2]
  return [
    {
      id: 'pay_ops_2026_06',
      entityId: ops.id,
      periodKey: '2026-06',
      status: 'approved_locked',
      employeeCount: 8,
      grossMinor: 48_000_000,
      payeMinor: 7_200_000,
      uifMinor: 480_000,
      sdlMinor: 480_000,
      netMinor: 39_840_000,
    },
    {
      id: 'pay_ops_2026_07',
      entityId: ops.id,
      periodKey: '2026-07',
      status: 'in_review',
      employeeCount: 8,
      grossMinor: 49_200_000,
      payeMinor: 7_450_000,
      uifMinor: 492_000,
      sdlMinor: 492_000,
      netMinor: 40_766_000,
    },
    {
      id: 'pay_svc_2026_07',
      entityId: svc.id,
      periodKey: '2026-07',
      status: 'approved_locked',
      employeeCount: 4,
      grossMinor: 26_000_000,
      payeMinor: 3_900_000,
      uifMinor: 260_000,
      sdlMinor: 260_000,
      netMinor: 21_580_000,
    },
  ]
}

export function buildDemoFx(entities: ProvingEntityBlueprint[]): DemoFxPosition[] {
  const svc = entities[2]
  return [
    {
      id: 'fx_svc_usd_ar',
      entityId: svc.id,
      currency: 'USD',
      openTxnMinor: 1_250_000,
      functionalMinor: 23_125_000,
      rateScaled: 1_850_000_000,
      rateScale: 8,
      revaluationOpen: true,
    },
  ]
}

export function buildDemoAssets(entities: ProvingEntityBlueprint[]): DemoAsset[] {
  const ops = entities[1]
  return [
    {
      id: 'fa_ops_laptop_fleet',
      entityId: ops.id,
      code: 'FA-100',
      name: 'Laptop fleet',
      costMinor: 24_000_000,
      residualMinor: 2_400_000,
      usefulLifeMonths: 36,
      depreciationPostedThrough: '2026-06',
    },
  ]
}

export function buildDemoJobCosts(entities: ProvingEntityBlueprint[]): DemoJobCost[] {
  const ops = entities[1]
  const svc = entities[2]
  return [
    {
      projectId: 'proj_ops_rollout',
      projectName: 'Ops customer rollout',
      entityId: ops.id,
      wipMinor: 4_200_000,
      billedMinor: 11_500_000,
      labourHours: 120,
    },
    {
      projectId: 'proj_svc_retainers',
      projectName: 'Services retainers',
      entityId: svc.id,
      wipMinor: 1_850_000,
      billedMinor: 0,
      labourHours: 46,
    },
  ]
}

export function defaultCloseBlockers(input: {
  bankLines: DemoBankLine[]
  payrollRuns: DemoPayrollRun[]
  fxPositions: DemoFxPosition[]
  assets: DemoAsset[]
  periodKey: ProvingPeriodKey
  entityId: string
  cutoverComplete: boolean
}): CloseBlocker[] {
  const entityBank = input.bankLines.filter((b) => b.entityId === input.entityId)
  const unreconciled = entityBank.some((b) => !b.matched)
  const openPay = input.payrollRuns.some(
    (p) => p.entityId === input.entityId && p.periodKey === input.periodKey && p.status !== 'approved_locked',
  )
  const openFx = input.fxPositions.some((f) => f.entityId === input.entityId && f.revaluationOpen)
  const missingDep = input.assets.some(
    (a) =>
      a.entityId === input.entityId &&
      a.depreciationPostedThrough !== undefined &&
      a.depreciationPostedThrough !== input.periodKey,
  )
  return [
    {
      code: 'unreconciled_bank',
      label: 'Unreconciled bank lines must be matched or dismissed',
      resolved: !unreconciled,
      evidence: unreconciled
        ? `${entityBank.filter((b) => !b.matched).length} unmatched line(s)`
        : 'All bank lines matched',
    },
    {
      code: 'unapproved_pay_run',
      label: 'Pay run for period must be approved_locked (or none)',
      resolved: !openPay,
      evidence: openPay ? 'Pay run still in_review/draft' : 'No open pay runs',
    },
    {
      code: 'open_fx_revaluation',
      label: 'Open FX revaluation must be posted or marked not applicable',
      resolved: !openFx,
      evidence: openFx ? 'USD position awaiting revaluation' : 'No open FX reval',
    },
    {
      code: 'incomplete_cutover',
      label: 'Cutover package must be activated for book',
      resolved: input.cutoverComplete,
      evidence: input.cutoverComplete ? 'cutoverAt set' : 'cutover incomplete',
    },
    {
      code: 'missing_depreciation',
      label: 'Depreciation run posted through close period',
      resolved: !missingDep,
      evidence: missingDep ? 'Asset depreciation lagging period' : 'Depreciation current',
    },
    {
      code: 'open_ar_dispute',
      label: 'No blocking AR disputes (demo always clear after seed cleanup)',
      resolved: true,
      evidence: 'No disputes',
    },
  ]
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function freezeTrialBalance(input: {
  periodKey: ProvingPeriodKey
  entityId: string
  bookId: string
  frozenAt: string
  lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }>
  journalCount: number
}): ReportFreezeSnapshot {
  const totalDebitMinor = input.lines.reduce((n, l) => n + l.debitMinor, 0)
  const totalCreditMinor = input.lines.reduce((n, l) => n + l.creditMinor, 0)
  const trialBalanceHash = sha256Hex(
    JSON.stringify({
      periodKey: input.periodKey,
      entityId: input.entityId,
      bookId: input.bookId,
      lines: input.lines,
      totalDebitMinor,
      totalCreditMinor,
    }),
  )
  return {
    periodKey: input.periodKey,
    entityId: input.entityId,
    bookId: input.bookId,
    frozenAt: input.frozenAt,
    trialBalanceHash,
    totalDebitMinor,
    totalCreditMinor,
    journalCount: input.journalCount,
    immutable: true,
    externalEgressAllowed: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }
}

export function buildAcceptanceChecklist(): AcceptanceCheckItem[] {
  const steps: Array<Omit<AcceptanceCheckItem, 'checked'>> = [
    {
      id: 'acc_1',
      section: 'Environment',
      step: 1,
      title: 'Confirm development/staging tenant',
      detail:
        'Org is non-production. Finance module enabled. No main/prod deploy planned from this run.',
      evidenceHint: 'Portal URL + orgId chip',
      required: true,
    },
    {
      id: 'acc_2',
      section: 'Seed',
      step: 2,
      title: 'Run deterministic proving seed',
      detail:
        'Multi-entity HOLD/OPS/SVC books, COA, three periods, sample AR/AP, bank, payroll, FX, assets, job costing dims.',
      evidenceHint: 'Seed snapshot seedKey + entity codes',
      required: true,
    },
    {
      id: 'acc_3',
      section: 'Seed',
      step: 3,
      title: 'Re-run seed is idempotent',
      detail: 'Second seed with same seedKey returns identical snapshot digest without duplicate journals.',
      evidenceHint: 'Jest proving-domain or UI re-seed message',
      required: true,
    },
    {
      id: 'acc_4',
      section: 'Close',
      step: 4,
      title: 'Open period has activity',
      detail: 'Posted journals exist in the target period before close.',
      evidenceHint: 'Ledger journal count > 0',
      required: true,
    },
    {
      id: 'acc_5',
      section: 'Close',
      step: 5,
      title: 'Close checklist shows real blockers',
      detail:
        'Unreconciled bank / unapproved pay run / open FX reval / incomplete cutover / missing depreciation block close.',
      evidenceHint: 'Close run status=blocked with unresolved codes',
      required: true,
    },
    {
      id: 'acc_6',
      section: 'Close',
      step: 6,
      title: 'Resolve blockers then hard-close',
      detail: 'After resolving blockers, period transitions to hard_closed with approval evidence.',
      evidenceHint: 'Close run status=closed + period.status',
      required: true,
    },
    {
      id: 'acc_7',
      section: 'Close',
      step: 7,
      title: 'Reports freeze after close',
      detail:
        'Trial balance freeze snapshot hash is stable; further ordinary posts to hard-closed period fail.',
      evidenceHint: 'freeze.trialBalanceHash + rejected post',
      required: true,
    },
    {
      id: 'acc_8',
      section: 'Packaging',
      step: 8,
      title: 'Dry-run SARS EMP201 pack',
      detail: 'Download pack contains realistic PAYE/UIF/SDL rows. sarsSubmissionInitiated remains false.',
      evidenceHint: 'packaging dry-run file list + hard gates',
      required: true,
    },
    {
      id: 'acc_9',
      section: 'Packaging',
      step: 9,
      title: 'Dry-run payment instruction pack',
      detail: 'EFT instruction CSV/JSON generated. externalPaymentInitiated remains false.',
      evidenceHint: 'payment.eft_instructions dry-run',
      required: true,
    },
    {
      id: 'acc_10',
      section: 'Packaging',
      step: 10,
      title: 'Dry-run accountant pack set',
      detail: 'Trial balance, GL, open items, audit extract packs download with content.',
      evidenceHint: 'accountant.* dry-run rowCount > 0',
      required: true,
    },
    {
      id: 'acc_11',
      section: 'Hard gates',
      step: 11,
      title: 'Hard gates still false',
      detail:
        'No SARS submit, no external payment initiate, no mass email, externalEgressAllowed=false across seed/close/packs.',
      evidenceHint: 'hardGates object on snapshot + packs',
      required: true,
    },
    {
      id: 'acc_12',
      section: 'Handoff',
      step: 12,
      title: 'Print/export checklist for accountant sitting',
      detail:
        'Use browser print on this page; attach seedKey, close run ids, pack digests to Quinn evidence.',
      evidenceHint: 'Printed checklist or screenshot',
      required: false,
    },
  ]
  return steps.map((s) => ({ ...s, checked: false }))
}

export const COA_TEMPLATE: Array<{
  code: string
  name: string
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  normalBalance: 'debit' | 'credit'
  controlAccountRole?: 'receivables' | 'payables' | 'tax' | 'payroll' | 'bank' | 'retained_earnings'
}> = [
  { code: '1000', name: 'Bank', accountType: 'asset', normalBalance: 'debit', controlAccountRole: 'bank' },
  {
    code: '1100',
    name: 'Accounts receivable',
    accountType: 'asset',
    normalBalance: 'debit',
    controlAccountRole: 'receivables',
  },
  // Non-control asset used for proving kit manual journals (control accounts reject manual posts).
  { code: '1200', name: 'Other debtors (manual)', accountType: 'asset', normalBalance: 'debit' },
  { code: '1500', name: 'Fixed assets', accountType: 'asset', normalBalance: 'debit' },
  {
    code: '2000',
    name: 'Accounts payable',
    accountType: 'liability',
    normalBalance: 'credit',
    controlAccountRole: 'payables',
  },
  {
    code: '2100',
    name: 'VAT control',
    accountType: 'liability',
    normalBalance: 'credit',
    controlAccountRole: 'tax',
  },
  {
    code: '2200',
    name: 'Payroll control',
    accountType: 'liability',
    normalBalance: 'credit',
    controlAccountRole: 'payroll',
  },
  { code: '3000', name: 'Share capital', accountType: 'equity', normalBalance: 'credit' },
  {
    code: '3100',
    name: 'Retained earnings',
    accountType: 'equity',
    normalBalance: 'credit',
    controlAccountRole: 'retained_earnings',
  },
  { code: '4000', name: 'Revenue', accountType: 'income', normalBalance: 'credit' },
  { code: '5000', name: 'Operating expense', accountType: 'expense', normalBalance: 'debit' },
  { code: '5100', name: 'Depreciation expense', accountType: 'expense', normalBalance: 'debit' },
  { code: '5200', name: 'FX gain/loss', accountType: 'expense', normalBalance: 'debit' },
]
