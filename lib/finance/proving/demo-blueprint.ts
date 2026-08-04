import { createHash } from 'crypto'
import type {
  AcceptanceCheckItem,
  CloseBlocker,
  DemoArApLine,
  DemoAsset,
  DemoBankLine,
  DemoFxPosition,
  DemoIcTransaction,
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
  const svc = entities[2]
  // Multi-month recon history across ≥2 entities. July OPS still has unmatched lines to force blockers.
  return [
    {
      id: 'bank_ops_2026_05_1',
      entityId: ops.id,
      bookingDate: '2026-05-12',
      periodKey: '2026-05',
      statementRef: 'STM-OPS-2026-05',
      description: 'May customer deposit',
      amountMinor: 3_200_000,
      currency: 'ZAR',
      matched: true,
    },
    {
      id: 'bank_ops_2026_06_1',
      entityId: ops.id,
      bookingDate: '2026-06-10',
      periodKey: '2026-06',
      statementRef: 'STM-OPS-2026-06',
      description: 'June EFT batch',
      amountMinor: 4_100_000,
      currency: 'ZAR',
      matched: true,
    },
    {
      id: 'bank_ops_1',
      entityId: ops.id,
      bookingDate: '2026-07-05',
      periodKey: '2026-07',
      statementRef: 'STM-OPS-2026-07',
      description: 'Customer receipt INV-1001 partial',
      amountMinor: 5_750_000,
      currency: 'ZAR',
      matched: true,
    },
    {
      id: 'bank_ops_2',
      entityId: ops.id,
      bookingDate: '2026-07-18',
      periodKey: '2026-07',
      statementRef: 'STM-OPS-2026-07',
      description: 'Unmatched card fee',
      amountMinor: -45_000,
      currency: 'ZAR',
      matched: false,
    },
    {
      id: 'bank_ops_3',
      entityId: ops.id,
      bookingDate: '2026-07-22',
      periodKey: '2026-07',
      statementRef: 'STM-OPS-2026-07',
      description: 'Supplier payment BILL-9001 pending match',
      amountMinor: -2_300_000,
      currency: 'ZAR',
      matched: false,
    },
    {
      id: 'bank_svc_2026_05_1',
      entityId: svc.id,
      bookingDate: '2026-05-20',
      periodKey: '2026-05',
      statementRef: 'STM-SVC-2026-05',
      description: 'May retainer receipt',
      amountMinor: 2_500_000,
      currency: 'ZAR',
      matched: true,
    },
    {
      id: 'bank_svc_2026_06_1',
      entityId: svc.id,
      bookingDate: '2026-06-18',
      periodKey: '2026-06',
      statementRef: 'STM-SVC-2026-06',
      description: 'June retainer receipt',
      amountMinor: 2_500_000,
      currency: 'ZAR',
      matched: true,
    },
    {
      id: 'bank_svc_2026_07_1',
      entityId: svc.id,
      bookingDate: '2026-07-19',
      periodKey: '2026-07',
      statementRef: 'STM-SVC-2026-07',
      description: 'July retainer receipt',
      amountMinor: 2_500_000,
      currency: 'ZAR',
      matched: true,
    },
  ]
}

export function buildDemoPayroll(entities: ProvingEntityBlueprint[]): DemoPayrollRun[] {
  const ops = entities[1]
  const svc = entities[2]
  // Multi-month payroll: OPS+SVC across three periods. Latest OPS stays in_review to force close blockers.
  const mk = (
    id: string,
    entityId: string,
    periodKey: ProvingPeriodKey,
    status: DemoPayrollRun['status'],
    employees: number,
    gross: number,
  ): DemoPayrollRun => {
    const paye = Math.round(gross * 0.15)
    const uif = Math.round(gross * 0.01)
    const sdl = Math.round(gross * 0.01)
    return {
      id,
      entityId,
      periodKey,
      status,
      employeeCount: employees,
      grossMinor: gross,
      payeMinor: paye,
      uifMinor: uif,
      sdlMinor: sdl,
      netMinor: gross - paye - uif - sdl,
    }
  }
  return [
    mk('pay_ops_2026_05', ops.id, '2026-05', 'approved_locked', 8, 47_000_000),
    mk('pay_ops_2026_06', ops.id, '2026-06', 'approved_locked', 8, 48_000_000),
    mk('pay_ops_2026_07', ops.id, '2026-07', 'in_review', 8, 49_200_000),
    mk('pay_svc_2026_05', svc.id, '2026-05', 'approved_locked', 4, 24_500_000),
    mk('pay_svc_2026_06', svc.id, '2026-06', 'approved_locked', 4, 25_200_000),
    mk('pay_svc_2026_07', svc.id, '2026-07', 'approved_locked', 4, 26_000_000),
  ]
}

export function buildDemoIc(entities: ProvingEntityBlueprint[]): DemoIcTransaction[] {
  const ops = entities[1]
  const svc = entities[2]
  return [
    {
      id: 'ic_ops_svc_2026_05',
      sourceEntityId: ops.id,
      receivingEntityId: svc.id,
      periodKey: '2026-05',
      description: 'May management fee OPS → SVC',
      amountMinor: 1_150_000,
      currency: 'ZAR',
      status: 'matched',
      dueToAccountCode: '2300',
      dueFromAccountCode: '1300',
    },
    {
      id: 'ic_ops_svc_2026_06',
      sourceEntityId: ops.id,
      receivingEntityId: svc.id,
      periodKey: '2026-06',
      description: 'June management fee OPS → SVC',
      amountMinor: 1_150_000,
      currency: 'ZAR',
      status: 'matched',
      dueToAccountCode: '2300',
      dueFromAccountCode: '1300',
    },
    {
      id: 'ic_ops_svc_2026_07',
      sourceEntityId: ops.id,
      receivingEntityId: svc.id,
      periodKey: '2026-07',
      description: 'July management fee OPS → SVC (open until program resolve)',
      amountMinor: 1_150_000,
      currency: 'ZAR',
      status: 'open',
      dueToAccountCode: '2300',
      dueFromAccountCode: '1300',
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
      asOfPeriodKey: '2026-07',
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
  icTransactions?: DemoIcTransaction[]
  periodKey: ProvingPeriodKey
  entityId: string
  cutoverComplete: boolean
}): CloseBlocker[] {
  const entityBank = input.bankLines.filter(
    (b) =>
      b.entityId === input.entityId &&
      (b.periodKey === undefined || b.periodKey === input.periodKey),
  )
  const unreconciled = entityBank.some((b) => !b.matched)
  const openPay = input.payrollRuns.some(
    (p) => p.entityId === input.entityId && p.periodKey === input.periodKey && p.status !== 'approved_locked',
  )
  const openFx = input.fxPositions.some(
    (f) =>
      f.entityId === input.entityId &&
      f.revaluationOpen &&
      (f.asOfPeriodKey === undefined || f.asOfPeriodKey === input.periodKey),
  )
  const missingDep = input.assets.some(
    (a) =>
      a.entityId === input.entityId &&
      a.depreciationPostedThrough !== undefined &&
      a.depreciationPostedThrough < input.periodKey,
  )
  const openIc = (input.icTransactions ?? []).some(
    (t) =>
      t.periodKey === input.periodKey &&
      t.status !== 'matched' &&
      (t.sourceEntityId === input.entityId || t.receivingEntityId === input.entityId),
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
      code: 'open_intercompany',
      label: 'Intercompany for period must be matched (or none)',
      resolved: !openIc,
      evidence: openIc ? 'Open IC transaction on entity for period' : 'IC matched or N/A',
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
      section: 'Multi-month',
      step: 12,
      title: 'Run multi-month close program (≥3 periods × ≥2 entities)',
      detail:
        'OPS+SVC (or equivalent) close 2026-05/06/07 with IC matched, FX closed where applicable, payroll locked, bank recon history, packaging dry-run.',
      evidenceHint: 'program.closedPeriodCount ≥ 3 and closedEntityCount ≥ 2',
      required: true,
    },
    {
      id: 'acc_13',
      section: 'Multi-month',
      step: 13,
      title: 'Confirm IC + FX + payroll lock evidence',
      detail: 'Program evidence shows matched IC, locked payroll runs, and FX reval closed on participating entities.',
      evidenceHint: 'program.evidence ic/fx/payroll counters',
      required: true,
    },
    {
      id: 'acc_14',
      section: 'Handoff',
      step: 14,
      title: 'Export accountant acceptance pack (sign-off artifact)',
      detail:
        'Export markdown+JSON pack with checklist, freeze hashes, packaging digests, and blank human sign-off lines. Not a wet-signature product.',
      evidenceHint: 'acceptancePackExport.contentSha256 + evidence folder paths',
      required: true,
    },
    {
      id: 'acc_15',
      section: 'Handoff',
      step: 15,
      title: 'Print/export checklist for accountant sitting',
      detail:
        'Use browser print or exported pack; attach seedKey, program id, close run ids, pack digests to Quinn evidence.',
      evidenceHint: 'Printed checklist / exported pack path',
      required: false,
    },
  ]
  return steps.map((s) => ({ ...s, checked: false }))
}

export const MULTI_MONTH_PROGRAM_KEY = 'pib-multi-month-close-v1'

export const PROVING_EVIDENCE_FOLDER_PATHS = [
  'artifacts/finance/multi-month-close/',
  'artifacts/finance/multi-month-close/seed/',
  'artifacts/finance/multi-month-close/close-runs/',
  'artifacts/finance/multi-month-close/packaging/',
  'artifacts/finance/multi-month-close/acceptance/',
  'docs/operations/finance/multi-month-close-program-2026-08-03.md',
  'docs/operations/finance/phase6-accountant-acceptance-pack-2026-08-03.md',
  '/portal/finance/proving',
  '/portal/finance/runbooks',
] as const

export function buildAcceptancePackMarkdown(input: {
  orgId: string
  seedKey: string
  companyName: string
  programId?: string
  exportedAt: string
  checklist: AcceptanceCheckItem[]
  freezeHashes: string[]
  packagingDigests: string[]
  evidenceFolderPaths: string[]
  gaps: Array<{ code: string; summary: string }>
}): string {
  const tick = (value: string) => '`' + value + '`'
  const lines: string[] = [
    "# External accountant acceptance pack — PiB Finance multi-month close",
    "",
    "**Artifact type:** checklist pack for human sign-off (not a wet-signature product).",
    "**Hard gates:** no SARS submit · no payment initiate · no mass client email · development/staging only.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Org | ${input.orgId} |`,
    `| Company | ${input.companyName} |`,
    `| Seed key | ${input.seedKey} |`,
    `| Program id | ${input.programId ?? '—'} |`,
    `| Exported at | ${input.exportedAt} |`,
    "",
    "## Evidence folder structure",
    "",
    ...input.evidenceFolderPaths.map((path) => '- ' + tick(path)),
    "",
    "## Freeze hashes",
    "",
    ...(input.freezeHashes.length ? input.freezeHashes.map((h) => '- ' + tick(h)) : ['- (none yet)']),
    "",
    "## Packaging sample digests",
    "",
    ...(input.packagingDigests.length
      ? input.packagingDigests.map((h) => '- ' + tick(h))
      : ['- (none yet)']),
    "",
    "## Checklist",
    "",
  ]
  for (const item of input.checklist) {
    const box = item.checked ? '[x]' : '[ ]'
    const req = item.required ? 'required' : 'optional'
    lines.push(`${box} **${item.step}. ${item.title}** (${item.section}, ${req})`)
    lines.push(`   ${item.detail}`)
    lines.push(`   Evidence hint: ${item.evidenceHint}`)
    lines.push('')
  }
  lines.push('## Known gaps (do not hide)')
  lines.push('')
  if (!input.gaps.length) {
    lines.push('- None recorded on this export.')
  } else {
    for (const g of input.gaps) {
      lines.push(`- **${g.code}:** ${g.summary}`)
    }
  }
  lines.push('')
  lines.push('## Accountant sign-off (human completes)')
  lines.push('')
  lines.push('I confirm I ran this pack in one sitting against the stated seed/program and hard gates remain false.')
  lines.push('')
  lines.push('| Field | Sign |')
  lines.push('| --- | --- |')
  lines.push('| Accountant name | _______________________________ |')
  lines.push('| Firm | _______________________________ |')
  lines.push('| Date | _______________________________ |')
  lines.push('| Signature (hand/print) | _______________________________ |')
  lines.push('| Notes | _______________________________ |')
  lines.push('')
  lines.push('_Wet-signature product: false — this is a printable checklist artifact only._')
  lines.push('')
  return lines.join('\n')
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
  { code: '1300', name: 'Due from intercompany', accountType: 'asset', normalBalance: 'debit' },
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
  { code: '2300', name: 'Due to intercompany', accountType: 'liability', normalBalance: 'credit' },
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
