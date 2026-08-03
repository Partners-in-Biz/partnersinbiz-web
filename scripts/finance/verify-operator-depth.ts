import {
  buildPeriodCloseCommandCentre,
  planMultiDocumentAllocation,
  selectAllFilteredIds,
} from '../../lib/accounting/operator-depth'
import {
  OperatorDepthFinanceService,
  createEmptyOperatorDepthStore,
  cloneOperatorDepthStore,
} from '../../lib/finance/operator-depth/service'
import type { FinanceActorContext } from '../../lib/finance/types'

function actor(): FinanceActorContext {
  return {
    uid: 'user-1',
    orgId: 'org-a',
    membershipActive: true,
    membershipRole: 'admin',
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg-1',
        orgId: 'org-a',
        userId: 'user-1',
        role: 'finance_admin',
        status: 'active',
        legalEntityId: 'entity-a',
        scopeMode: 'entity',
      } as any,
    ],
  }
}

async function main() {
  const rows = Array.from({ length: 55 }, (_, i) => ({ id: `d-${i}`, status: 'draft' }))
  const bulk = selectAllFilteredIds(rows, { status: 'draft' })
  if (!bulk.capped || bulk.selectedIds.length !== 50) throw new Error('bulk select-all-filtered failed')

  const multi = planMultiDocumentAllocation({
    paymentId: 'pay-1',
    paymentUnallocatedMinor: 1000,
    overpayMode: 'on_account',
    targets: [{ targetType: 'customer_invoice', targetId: 'inv-1', outstandingMinor: 400 }],
  })
  if (multi.lines.length !== 2 || multi.externalPaymentInitiated !== false) throw new Error('overpay plan failed')

  const centre = buildPeriodCloseCommandCentre({
    orgId: 'org-a',
    legalEntityId: 'le',
    bookId: 'bk',
    asOfDate: '2026-08-31',
    reconciliations: [{ id: 'r1', status: 'open' }],
    journals: [{ id: 'j1', status: 'draft' }],
    payRuns: [{ id: 'p1', status: 'calculated' }],
    requireFxReval: true,
    fxRevaluationRuns: [],
  })
  if (centre.readyToClose || centre.blockerCount < 3) throw new Error('period close blockers incomplete')
  if (centre.externalPaymentInitiated !== false || centre.sarsSubmissionInitiated !== false) {
    throw new Error('hard gates failed')
  }

  let store = createEmptyOperatorDepthStore()
  const service = new OperatorDepthFinanceService(
    async () => cloneOperatorDepthStore(store),
    async (_b, after) => {
      store = cloneOperatorDepthStore(after)
    },
  )
  const a = actor()
  const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }
  await service.upsertSavedView(a, { ...scope, resourceKind: 'ledger_journals', name: 'Draft journals', filters: { status: 'draft' } })
  const planned = await service.planBulkSelection(a, {
    ...scope,
    action: 'bulk_void',
    resourceKind: 'ar_documents',
    rows: [{ id: '1', status: 'issued' }],
    explicitIds: ['1'],
  })
  if (!planned.auditId) throw new Error('bulk audit missing')

  console.log(
    JSON.stringify(
      {
        ok: true,
        bulkSelected: bulk.selectedIds.length,
        bulkCapped: bulk.capped,
        multiLines: multi.lines.length,
        overpayOnAccount: multi.lines.some((l) => l.targetType === 'on_account'),
        blockerCodes: centre.blockers.map((b) => b.code),
        readyToClose: centre.readyToClose,
        hardGates: {
          externalPaymentInitiated: false,
          sarsSubmissionInitiated: false,
          externalEgressAllowed: false,
        },
        auditId: planned.auditId,
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
