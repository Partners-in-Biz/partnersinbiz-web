import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { allowlistedJournalLine, buildReversalLines } from '@/lib/accounting/foundation'
import {
  buildProjectProfitAndLoss,
  buildProjectWip,
  buildTimeCostLines,
  laborCostMinor,
} from '@/lib/accounting/job-costing'
import {
  FinanceJobCostingService,
  createEmptyJobCostingStore,
  type JobCostingStore,
} from '@/lib/accounting/job-costing-service'
import type { LedgerAccount, PostedJournalEntry } from '@/lib/accounting/types'
import type { FinanceCustomerInvoice } from '@/lib/accounting/documents-types'
import { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

function actor(uid = 'u_admin', orgId = 'org_1'): FinanceActorContext {
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
        bookId: 'book_1',
        scopeMode: 'book',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

function serviceWith(storeRef: { current: JobCostingStore }) {
  return new FinanceJobCostingService(
    async () => storeRef.current,
    async (_before, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T12:00:00.000Z',
  )
}

function account(partial: Partial<LedgerAccount> & Pick<LedgerAccount, 'id' | 'code' | 'accountType' | 'normalBalance'>): LedgerAccount {
  return {
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    schemaVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'u',
    name: partial.code,
    currency: 'ZAR',
    currencyPolicy: 'functional_only',
    reportMapping: partial.accountType,
    postingAllowed: true,
    activeFrom: '2026-01-01',
    ...partial,
  }
}

describe('job costing dimensions', () => {
  test('journal allowlist keeps project dimensions and reversal preserves them', () => {
    const line = allowlistedJournalLine({
      accountId: 'acc_exp',
      debitMinor: 1000,
      creditMinor: 0,
      description: 'Labor',
      projectId: 'proj_a',
      taskId: 'task_1',
      costCentreCode: 'CC-10',
      employeeId: 'emp_1',
    })
    expect(line.projectId).toBe('proj_a')
    expect(line.taskId).toBe('task_1')
    expect(line.costCentreCode).toBe('CC-10')
    const rev = buildReversalLines([line])[0]
    expect(rev.projectId).toBe('proj_a')
    expect(rev.debitMinor).toBe(0)
    expect(rev.creditMinor).toBe(1000)
  })

  test('taskId without projectId is rejected', () => {
    expect(() =>
      allowlistedJournalLine({
        accountId: 'a',
        debitMinor: 1,
        creditMinor: 0,
        taskId: 't1',
      }),
    ).toThrow(/projectId/)
  })
})

describe('time costing pure math', () => {
  test('labor cost rounds half-up from minutes and hourly minor rate', () => {
    expect(laborCostMinor(60, 85000)).toBe(85000)
    expect(laborCostMinor(30, 85000)).toBe(42500)
    expect(laborCostMinor(1, 100)).toBe(2) // 100/60 -> 1.666 -> 2
  })

  test('buildTimeCostLines rejects already-invoiced entries for draft invoice purpose', () => {
    expect(() =>
      buildTimeCostLines(
        [
          {
            timeEntryId: 'te1',
            orgId: 'org_1',
            projectId: 'proj_a',
            billable: true,
            durationMinutes: 60,
            costRateMinorPerHour: 10000,
            currency: 'ZAR',
            invoiceId: 'inv_1',
            endAt: '2026-08-01T10:00:00.000Z',
          },
        ],
        'draft_invoice_lines',
        'org_1',
      ),
    ).toThrow(/double-billing/)
  })
})

describe('project P&L and WIP', () => {
  const income = account({ id: 'acc_rev', code: '4000', accountType: 'income', normalBalance: 'credit' })
  const expense = account({ id: 'acc_exp', code: '5000', accountType: 'expense', normalBalance: 'debit' })

  const journal: PostedJournalEntry = {
    id: 'je_1',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    periodId: 'p1',
    sourceType: 'manual',
    sourceId: 'm1',
    sourceVersion: 1,
    postingPurpose: 'document_issue',
    entryNumber: 1,
    entryType: 'standard',
    postingDate: '2026-08-01',
    documentDate: '2026-08-01',
    status: 'posted',
    description: 'project labor',
    currency: 'ZAR',
    policyVersionId: 'pol',
    accountingBasis: 'accrual',
    totalDebitMinor: 10000,
    totalCreditMinor: 10000,
    lines: [
      {
        id: 'je_1_0001',
        orgId: 'org_1',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        periodId: 'p1',
        journalEntryId: 'je_1',
        sequence: 1,
        accountId: 'acc_exp',
        debitMinor: 10000,
        creditMinor: 0,
        projectId: 'proj_a',
      },
      {
        id: 'je_1_0002',
        orgId: 'org_1',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        periodId: 'p1',
        journalEntryId: 'je_1',
        sequence: 2,
        accountId: 'acc_clear',
        debitMinor: 0,
        creditMinor: 10000,
      },
    ],
    lineDigest: 'x',
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
  }

  const clearing = account({ id: 'acc_clear', code: '2000', accountType: 'liability', normalBalance: 'credit' })

  test('project P&L includes project-tagged expense and invoice revenue', () => {
    const invoice = {
      id: 'inv_1',
      orgId: 'org_1',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      documentNumber: 'INV-1',
      customerCompanyId: 'co_1',
      customerSnapshot: { companyId: 'co_1', legalName: 'Client' },
      issueDate: '2026-08-02',
      dueDate: '2026-08-30',
      currency: 'ZAR',
      accountingBasis: 'accrual' as const,
      status: 'issued' as const,
      postingState: 'posted' as const,
      lines: [
        {
          id: 'l1',
          sequence: 1,
          description: 'Billable work',
          quantityMilli: 1000,
          unitPriceMinor: 20000,
          taxCodeId: 'tax',
          taxIncluded: false,
          taxableMinor: 20000,
          taxMinor: 0,
          grossMinor: 20000,
          revenueOrExpenseAccountId: 'acc_rev',
          taxTrace: {} as any,
          projectId: 'proj_a',
        },
      ],
      subtotalMinor: 20000,
      taxMinor: 0,
      totalMinor: 20000,
      outstandingMinor: 20000,
      settlementJournalEntryIds: [],
      immutable: true,
      schemaVersion: 1 as const,
      version: 1,
      createdAt: '2026-08-02T00:00:00.000Z',
      createdBy: 'u',
      updatedAt: '2026-08-02T00:00:00.000Z',
      updatedBy: 'u',
    } satisfies FinanceCustomerInvoice

    const pnl = buildProjectProfitAndLoss({
      scope: { orgId: 'org_1', legalEntityId: 'le_1', bookId: 'book_1' },
      projectId: 'proj_a',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      accountingBasis: 'accrual',
      accounts: [income, expense, clearing],
      journals: [journal],
      invoices: [invoice],
    })
    expect(pnl.totalCostMinor).toBe(10000)
    expect(pnl.totalRevenueMinor).toBe(20000)
    expect(pnl.grossMarginMinor).toBe(10000)
    expect(pnl.journalEntryIds).toContain('je_1')
    expect(pnl.invoiceIds).toContain('inv_1')
  })

  test('WIP uses open wip_cost applications for the project', () => {
    const pnl = { totalRevenueMinor: 20000, totalCostMinor: 10000 }
    const wip = buildProjectWip({
      scope: { orgId: 'org_1', legalEntityId: 'le_1', bookId: 'book_1' },
      projectId: 'proj_a',
      asOfDate: '2026-08-31',
      applications: [
        {
          id: 'tca_1',
          orgId: 'org_1',
          legalEntityId: 'le_1',
          bookId: 'book_1',
          purpose: 'wip_cost',
          status: 'applied',
          currency: 'ZAR',
          projectIds: ['proj_a'],
          timeEntryIds: ['te1'],
          lines: [
            {
              timeEntryId: 'te1',
              projectId: 'proj_a',
              durationMinutes: 60,
              costRateMinorPerHour: 5000,
              amountMinor: 5000,
              currency: 'ZAR',
              description: 'x',
              dimensions: { projectId: 'proj_a' },
            },
          ],
          totalCostMinor: 5000,
          requestId: 'r',
          idempotencyKey: 'k',
          immutable: true,
          contentHash: 'h',
          externalEgressAllowed: false,
          externalPaymentInitiated: false,
          canonicalPayloadVersion: 1,
          hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
          schemaVersion: 1,
          version: 1,
          createdAt: '2026-08-10T00:00:00.000Z',
          createdBy: 'u',
          updatedAt: '2026-08-10T00:00:00.000Z',
          updatedBy: 'u',
        },
      ],
      pnl,
    })
    expect(wip.unbilledLaborCostMinor).toBe(5000)
    expect(wip.wipMinor).toBe(5000)
    expect(wip.openTimeCostApplicationIds).toEqual(['tca_1'])
  })
})

describe('FinanceJobCostingService time cost apply', () => {
  test('applies once and refuses double-costing same time entry', async () => {
    const storeRef = { current: createEmptyJobCostingStore() }
    const svc = serviceWith(storeRef)
    const command = {
      id: 'tca_1',
      orgId: 'org_1',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      purpose: 'wip_cost' as const,
      currency: 'ZAR',
      laborExpenseAccountId: 'acc_exp',
      wipAssetAccountId: 'acc_wip',
      expectedVersion: 0,
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
      entries: [
        {
          timeEntryId: 'te_1',
          orgId: 'org_1',
          projectId: 'proj_a',
          billable: true,
          durationMinutes: 120,
          costRateMinorPerHour: 10000,
          currency: 'ZAR',
          endAt: '2026-08-01T12:00:00.000Z',
          description: 'Discovery',
        },
      ],
    }
    const first = await svc.applyTimeCost(actor(), command)
    expect(first.totalCostMinor).toBe(20000)
    expect(first.proposedJournalLines?.length).toBe(2)
    expect(first.proposedJournalLines?.[0].projectId).toBe('proj_a')
    expect(first.externalPaymentInitiated).toBe(false)
    expect(first.externalEgressAllowed).toBe(false)

    await expect(
      svc.applyTimeCost(actor(), {
        ...command,
        id: 'tca_2',
        requestId: 'req_2',
        idempotencyKey: 'idem_2',
      }),
    ).rejects.toBeInstanceOf(FinanceValidationError)

    await expect(
      svc.applyTimeCost(actor({ uid: 'viewer', membershipRole: 'viewer' } as any), command),
    ).rejects.toBeInstanceOf(Error)
  })

  test('idempotent replay returns same application', async () => {
    const storeRef = { current: createEmptyJobCostingStore() }
    const svc = serviceWith(storeRef)
    const command = {
      id: 'tca_idem',
      orgId: 'org_1',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      purpose: 'wip_cost' as const,
      currency: 'ZAR',
      laborExpenseAccountId: 'acc_exp',
      wipAssetAccountId: 'acc_wip',
      expectedVersion: 0,
      requestId: 'req_idem',
      idempotencyKey: 'idem_same',
      entries: [
        {
          timeEntryId: 'te_idem',
          orgId: 'org_1',
          projectId: 'proj_b',
          billable: true,
          durationMinutes: 60,
          costRateMinorPerHour: 5000,
          currency: 'ZAR',
          endAt: '2026-08-01T12:00:00.000Z',
        },
      ],
    }
    const a = await svc.applyTimeCost(actor(), command)
    const b = await svc.applyTimeCost(actor(), command)
    expect(b.id).toBe(a.id)
    expect(b.contentHash).toBe(a.contentHash)
  })

  test('viewer cannot apply time cost', async () => {
    const storeRef = { current: createEmptyJobCostingStore() }
    const svc = serviceWith(storeRef)
    const viewer: FinanceActorContext = {
      uid: 'u_view',
      orgId: 'org_1',
      membershipRole: 'viewer',
      membershipActive: true,
      financeModuleEnabled: true,
      assignments: [
        {
          id: 'asg_v',
          orgId: 'org_1',
          userId: 'u_view',
          legalEntityId: 'le_1',
          scopeMode: 'entity',
          role: 'finance_viewer',
          status: 'active',
        },
      ],
    }
    await expect(
      svc.applyTimeCost(viewer, {
        id: 'tca_v',
        orgId: 'org_1',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        purpose: 'wip_cost',
        currency: 'ZAR',
        laborExpenseAccountId: 'acc_exp',
        wipAssetAccountId: 'acc_wip',
        expectedVersion: 0,
        requestId: 'r',
        idempotencyKey: 'k',
        entries: [
          {
            timeEntryId: 'te_v',
            orgId: 'org_1',
            projectId: 'p',
            billable: true,
            durationMinutes: 60,
            costRateMinorPerHour: 1000,
            currency: 'ZAR',
            endAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })
})
