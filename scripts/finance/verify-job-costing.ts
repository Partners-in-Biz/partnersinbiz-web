/**
 * verify:finance:job-costing — pure domain + service golden path.
 * development/staging only. No SARS submit. No external payment initiate.
 */
import assert from 'node:assert/strict'
import { allowlistedJournalLine, buildReversalLines } from '../../lib/accounting/foundation'
import {
  buildJobCostClosedLoopTrace,
  buildProjectProfitAndLoss,
  buildProjectWip,
  buildTimeCostLines,
  laborCostMinor,
} from '../../lib/accounting/job-costing'
import {
  FinanceJobCostingService,
  createEmptyJobCostingStore,
} from '../../lib/accounting/job-costing-service'
import type { FinanceActorContext } from '../../lib/finance/types'
import type { LedgerAccount, PostedJournalEntry } from '../../lib/accounting/types'
import { HASH_ALGORITHM_VERSION } from '../../lib/finance/integrity'

const actor: FinanceActorContext = {
  uid: 'u1',
  orgId: 'org_1',
  membershipRole: 'admin',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [
    {
      id: 'a1',
      orgId: 'org_1',
      userId: 'u1',
      legalEntityId: 'le_1',
      scopeMode: 'entity',
      role: 'finance_admin',
      status: 'active',
    },
  ],
}

function account(id: string, code: string, accountType: LedgerAccount['accountType'], normalBalance: LedgerAccount['normalBalance']): LedgerAccount {
  return {
    id,
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    code,
    name: code,
    accountType,
    normalBalance,
    currency: 'ZAR',
    currencyPolicy: 'functional_only',
    reportMapping: accountType,
    postingAllowed: true,
    activeFrom: '2026-01-01',
    schemaVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'u',
  }
}

async function main() {
  assert.equal(laborCostMinor(60, 85000), 85000)
  const dims = allowlistedJournalLine({
    accountId: 'e',
    debitMinor: 100,
    creditMinor: 0,
    projectId: 'proj_a',
    taskId: 't1',
  })
  assert.equal(dims.projectId, 'proj_a')
  assert.equal(buildReversalLines([dims])[0].projectId, 'proj_a')

  const lines = buildTimeCostLines(
    [
      {
        timeEntryId: 'te1',
        orgId: 'org_1',
        projectId: 'proj_a',
        billable: true,
        durationMinutes: 90,
        costRateMinorPerHour: 10000,
        currency: 'ZAR',
        endAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    'wip_cost',
    'org_1',
  )
  assert.equal(lines[0].amountMinor, 15000)

  let store = createEmptyJobCostingStore()
  const svc = new FinanceJobCostingService(
    async () => store,
    async (_b, after) => {
      store = after
    },
    () => '2026-08-02T12:00:00.000Z',
  )
  const app = await svc.applyTimeCost(actor, {
    id: 'tca_v',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    purpose: 'wip_cost',
    currency: 'ZAR',
    laborExpenseAccountId: 'acc_exp',
    wipAssetAccountId: 'acc_wip',
    expectedVersion: 0,
    requestId: 'r1',
    idempotencyKey: 'k1',
    entries: [
      {
        timeEntryId: 'te_verify',
        orgId: 'org_1',
        projectId: 'proj_a',
        billable: true,
        durationMinutes: 60,
        costRateMinorPerHour: 20000,
        currency: 'ZAR',
        endAt: '2026-08-01T00:00:00.000Z',
        description: 'Build',
      },
    ],
  })
  assert.equal(app.totalCostMinor, 20000)
  assert.equal(app.externalPaymentInitiated, false)
  assert.equal(app.externalEgressAllowed, false)
  assert.ok(app.proposedJournalLines && app.proposedJournalLines.length === 2)

  let doubleBillingBlocked = false
  try {
    await svc.applyTimeCost(actor, {
      id: 'tca_v2',
      orgId: 'org_1',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      purpose: 'wip_cost',
      currency: 'ZAR',
      laborExpenseAccountId: 'acc_exp',
      wipAssetAccountId: 'acc_wip',
      expectedVersion: 0,
      requestId: 'r2',
      idempotencyKey: 'k2',
      entries: [
        {
          timeEntryId: 'te_verify',
          orgId: 'org_1',
          projectId: 'proj_a',
          billable: true,
          durationMinutes: 60,
          costRateMinorPerHour: 20000,
          currency: 'ZAR',
          endAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    })
  } catch {
    doubleBillingBlocked = true
  }
  assert.equal(doubleBillingBlocked, true)

  const expense = account('acc_exp', '5000', 'expense', 'debit')
  const clearing = account('acc_wip', '2100', 'liability', 'credit')
  const journal = {
    id: 'je1',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    periodId: 'p1',
    sourceType: 'manual',
    sourceId: 's',
    sourceVersion: 1,
    postingPurpose: 'document_issue',
    entryNumber: 1,
    entryType: 'standard',
    postingDate: '2026-08-01',
    documentDate: '2026-08-01',
    status: 'posted',
    description: 'x',
    currency: 'ZAR',
    policyVersionId: 'pol',
    accountingBasis: 'accrual',
    totalDebitMinor: 20000,
    totalCreditMinor: 20000,
    lines: [
      {
        id: 'je1_0001',
        orgId: 'org_1',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        periodId: 'p1',
        journalEntryId: 'je1',
        sequence: 1,
        accountId: 'acc_exp',
        debitMinor: 20000,
        creditMinor: 0,
        projectId: 'proj_a',
      },
      {
        id: 'je1_0002',
        orgId: 'org_1',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        periodId: 'p1',
        journalEntryId: 'je1',
        sequence: 2,
        accountId: 'acc_wip',
        debitMinor: 0,
        creditMinor: 20000,
      },
    ],
    lineDigest: 'd',
    approvalId: 'ap',
    approvalActorId: 'u',
    approvedAt: '2026-08-01T00:00:00.000Z',
    requestId: 'r',
    idempotencyKey: 'k',
    immutable: true,
    contentHash: 'h',
    canonicalPayloadVersion: 1,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    schemaVersion: 1,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'u',
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: 'u',
  } satisfies PostedJournalEntry

  const pnl = buildProjectProfitAndLoss({
    scope: { orgId: 'org_1', legalEntityId: 'le_1', bookId: 'book_1' },
    projectId: 'proj_a',
    fromDate: '2026-08-01',
    toDate: '2026-08-31',
    accountingBasis: 'accrual',
    accounts: [expense, clearing],
    journals: [journal],
  })
  assert.equal(pnl.totalCostMinor, 20000)

  const wipOpen = buildProjectWip({
    scope: { orgId: 'org_1', legalEntityId: 'le_1', bookId: 'book_1' },
    projectId: 'proj_a',
    asOfDate: '2026-08-31',
    applications: [app],
    pnl,
  })
  assert.equal(wipOpen.unbilledLaborCostMinor, 20000)
  assert.ok((wipOpen.aging || []).some((b) => b.amountMinor > 0))

  const draft = await svc.applyTimeCost(actor, {
    id: 'tca_draft',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    purpose: 'draft_invoice_lines',
    currency: 'ZAR',
    revenueAccountId: 'acc_rev',
    taxCodeId: 'tax',
    expectedVersion: 0,
    requestId: 'r_draft',
    idempotencyKey: 'k_draft',
    entries: [
      {
        timeEntryId: 'te_verify',
        orgId: 'org_1',
        projectId: 'proj_a',
        billable: true,
        durationMinutes: 60,
        costRateMinorPerHour: 20000,
        currency: 'ZAR',
        endAt: '2026-08-01T00:00:00.000Z',
        description: 'Build',
      },
    ],
  })
  assert.ok(draft.proposedInvoiceLines && draft.proposedInvoiceLines.length === 1)

  let doubleDraftBlocked = false
  try {
    await svc.applyTimeCost(actor, {
      id: 'tca_draft2',
      orgId: 'org_1',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      purpose: 'draft_invoice_lines',
      currency: 'ZAR',
      revenueAccountId: 'acc_rev',
      taxCodeId: 'tax',
      expectedVersion: 0,
      requestId: 'r_draft2',
      idempotencyKey: 'k_draft2',
      entries: [
        {
          timeEntryId: 'te_verify',
          orgId: 'org_1',
          projectId: 'proj_a',
          billable: true,
          durationMinutes: 60,
          costRateMinorPerHour: 20000,
          currency: 'ZAR',
          endAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    })
  } catch {
    doubleDraftBlocked = true
  }
  assert.equal(doubleDraftBlocked, true)

  const wipReleased = buildProjectWip({
    scope: { orgId: 'org_1', legalEntityId: 'le_1', bookId: 'book_1' },
    projectId: 'proj_a',
    asOfDate: '2026-08-31',
    applications: [app, draft],
    pnl,
  })
  assert.equal(wipReleased.unbilledLaborCostMinor, 0)
  assert.equal(wipReleased.releasedLaborCostMinor, 20000)

  const trace = buildJobCostClosedLoopTrace({
    scope: { orgId: 'org_1', legalEntityId: 'le_1', bookId: 'book_1' },
    projectId: 'proj_a',
    asOfDate: '2026-08-31',
    quoteId: 'quo_v',
    applications: [app, draft],
    pnl: {
      ...pnl,
      cashAppliedMinor: 0,
      outstandingArMinor: 0,
      invoiceCashSlices: [],
    },
    wip: wipReleased,
  })
  assert.equal(trace.steps.find((s) => s.id === 'time_cost')?.status, 'done')
  assert.equal(trace.steps.find((s) => s.id === 'invoice')?.status, 'done')
  assert.equal(trace.hardGates.sarsSubmissionInitiated, false)

  console.log(
    JSON.stringify(
      {
        ok: true,
        suite: 'job-costing',
        totalCostMinor: app.totalCostMinor,
        doubleBillingBlocked,
        doubleDraftBlocked,
        projectCostMinor: pnl.totalCostMinor,
        wipReleasedMinor: wipReleased.releasedLaborCostMinor,
        closedLoopSteps: trace.steps.map((s) => s.id),
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        noEgress: true,
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
