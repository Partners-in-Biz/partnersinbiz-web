import {
  applyInboundPosition,
  applyOutboundPosition,
  averageUnitCostMinor,
  buildCogsJournalLines,
  costForQuantityMilli,
  FinanceValidationError,
} from '@/lib/accounting/inventory'
import { InMemoryInventoryFinanceService } from '@/lib/accounting/inventory-service'
import type { FinanceActorContext } from '@/lib/finance/types'

const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

function actor(uid = 'admin-1', role: FinanceActorContext['assignments'][number]['role'] = 'finance_admin'): FinanceActorContext {
  return {
    uid,
    orgId: scope.orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [{
      id: `asg-${uid}`,
      orgId: scope.orgId,
      userId: uid,
      legalEntityId: scope.legalEntityId,
      scopeMode: 'entity',
      role,
      status: 'active',
    }],
  }
}

describe('inventory pure COGS / average-cost math', () => {
  test('costForQuantityMilli half-up and average unit cost', () => {
    expect(costForQuantityMilli(100_00, 1000)).toBe(100_00)
    expect(costForQuantityMilli(100_00, 500)).toBe(50_00)
    // 33.33 * 1 unit approx: unit 3333 minor on 1000 milli -> 3333
    expect(costForQuantityMilli(3333, 1000)).toBe(3333)
    expect(averageUnitCostMinor(300_00, 3000)).toBe(100_00)
    expect(averageUnitCostMinor(0, 0)).toBe(0)
  })

  test('weighted average after two receipts then COGS on partial sale', () => {
    let pos = { quantityOnHandMilli: 0, inventoryValueMinor: 0 }
    pos = applyInboundPosition(pos, 2000, 100_00) // 2 @ 100
    expect(pos.inventoryValueMinor).toBe(200_00)
    pos = applyInboundPosition(pos, 2000, 200_00) // 2 @ 200
    expect(pos.quantityOnHandMilli).toBe(4000)
    expect(pos.inventoryValueMinor).toBe(600_00)
    expect(pos.averageUnitCostMinor).toBe(150_00)

    const out = applyOutboundPosition(pos, 1000) // sell 1
    expect(out.unitCostMinor).toBe(150_00)
    expect(out.cogsMinor).toBe(150_00)
    expect(out.quantityOnHandMilli).toBe(3000)
    expect(out.inventoryValueMinor).toBe(450_00)
  })

  test('full depletion clears value remainder for COGS correctness', () => {
    const pos = applyInboundPosition({ quantityOnHandMilli: 0, inventoryValueMinor: 0 }, 3, 100) // 3 milli weird qty
    // cost = floor/half-up 100*3/1000 = 0
    expect(pos.totalCostMinor).toBe(0)
    const stock = applyInboundPosition({ quantityOnHandMilli: 0, inventoryValueMinor: 0 }, 1000, 10_00)
    const odd = applyInboundPosition(stock, 1000, 10_01) // 1000 + 1001 = 2001 value for 2 units
    expect(odd.inventoryValueMinor).toBe(20_01)
    const first = applyOutboundPosition(odd, 1000)
    const second = applyOutboundPosition(
      { quantityOnHandMilli: first.quantityOnHandMilli, inventoryValueMinor: first.inventoryValueMinor },
      1000,
    )
    expect(second.quantityOnHandMilli).toBe(0)
    expect(second.inventoryValueMinor).toBe(0)
    expect(first.cogsMinor + second.cogsMinor).toBe(20_01)
  })

  test('rejects insufficient quantity and builds balanced COGS journal', () => {
    expect(() => applyOutboundPosition({ quantityOnHandMilli: 500, inventoryValueMinor: 50 }, 1000)).toThrow(FinanceValidationError)
    const journal = buildCogsJournalLines({
      cogsAccountId: 'acc-cogs',
      inventoryAssetAccountId: 'acc-inv',
      cogsMinor: 125_50,
      sku: 'WIDGET',
    })
    expect(journal.balanced).toBe(true)
    expect(journal.lines).toHaveLength(2)
    expect(journal.lines[0]).toMatchObject({ accountId: 'acc-cogs', debitMinor: 125_50, creditMinor: 0 })
    expect(journal.lines[1]).toMatchObject({ accountId: 'acc-inv', debitMinor: 0, creditMinor: 125_50 })
    const debits = journal.lines.reduce((s, l) => s + l.debitMinor, 0)
    const credits = journal.lines.reduce((s, l) => s + l.creditMinor, 0)
    expect(debits).toBe(credits)
  })
})

describe('inventory stock lite lifecycle + COGS on invoice issue', () => {
  test('item master → bill receipt → invoice issue COGS → adjustment with audit; hard gates false', async () => {
    const postedJournals: string[] = []
    const svc = new InMemoryInventoryFinanceService(undefined, undefined, async ({ journalEntryId }) => {
      postedJournals.push(journalEntryId)
      return { id: journalEntryId }
    })
    const admin = actor('admin-1')

    const item = await svc.createItem(admin, {
      id: 'item-widget',
      ...scope,
      sku: 'widget-01',
      name: 'Widget',
      incomeAccountId: 'acc-income',
      cogsAccountId: 'acc-cogs',
      inventoryAssetAccountId: 'acc-inv',
      trackQuantity: true,
      currency: 'ZAR',
      expectedVersion: 0,
      requestId: 'r1',
      idempotencyKey: 'idem-item',
    })
    expect(item.sku).toBe('WIDGET-01')
    expect(item.trackQuantity).toBe(true)
    expect(item.quantityOnHandMilli).toBe(0)
    expect(item.sarsSubmissionInitiated).toBe(false)
    expect(item.externalPaymentInitiated).toBe(false)
    expect(item.externalEgressAllowed).toBe(false)

    const receipt = await svc.applyBillReceipt(admin, {
      id: 'batch-bill-1',
      ...scope,
      billId: 'bill-1',
      billNumber: 'BILL-1',
      receivedAt: '2026-08-01',
      lines: [
        { itemId: item.id, quantityMilli: 5000, unitCostMinor: 40_00, sourceLineId: 'bl1' }, // 5 @ 40
        { sku: 'WIDGET-01', quantityMilli: 5000, unitCostMinor: 60_00, sourceLineId: 'bl2' }, // 5 @ 60
      ],
      requestId: 'r2',
      idempotencyKey: 'idem-bill',
    })
    expect(receipt.movements).toHaveLength(2)
    const afterBill = await svc.getItem(admin, scope, item.id)
    expect(afterBill.quantityOnHandMilli).toBe(10_000)
    expect(afterBill.inventoryValueMinor).toBe(500_00) // 200 + 300
    expect(averageUnitCostMinor(afterBill.inventoryValueMinor, afterBill.quantityOnHandMilli)).toBe(50_00)

    const issue = await svc.applyInvoiceIssue(admin, {
      id: 'batch-inv-1',
      ...scope,
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1',
      issuedAt: '2026-08-02',
      lines: [
        { itemId: item.id, quantityMilli: 4000, sourceLineId: 'il1' }, // sell 4 @ avg 50 = COGS 200
      ],
      requestId: 'r3',
      idempotencyKey: 'idem-inv',
    })
    expect(issue.movements).toHaveLength(1)
    expect(issue.cogsPostings).toHaveLength(1)
    const cogs = issue.cogsPostings[0]
    expect(cogs.cogsMinor).toBe(200_00)
    expect(cogs.unitCostMinor).toBe(50_00)
    expect(cogs.balanced).toBe(true)
    expect(cogs.lines[0].debitMinor).toBe(200_00)
    expect(cogs.lines[1].creditMinor).toBe(200_00)
    expect(cogs.sarsSubmissionInitiated).toBe(false)
    expect(cogs.externalPaymentInitiated).toBe(false)
    expect(cogs.externalEgressAllowed).toBe(false)
    expect(postedJournals.length).toBe(1)

    const afterSale = await svc.getItem(admin, scope, item.id)
    expect(afterSale.quantityOnHandMilli).toBe(6000)
    expect(afterSale.inventoryValueMinor).toBe(300_00)

    // non-tracked service line should not move stock
    const service = await svc.createItem(admin, {
      id: 'item-svc',
      ...scope,
      sku: 'SVC-1',
      name: 'Consulting',
      incomeAccountId: 'acc-income',
      cogsAccountId: 'acc-cogs',
      inventoryAssetAccountId: 'acc-inv',
      trackQuantity: false,
      expectedVersion: 0,
      requestId: 'r4',
      idempotencyKey: 'idem-svc',
    })
    const svcIssue = await svc.applyInvoiceIssue(admin, {
      id: 'batch-inv-2',
      ...scope,
      invoiceId: 'inv-2',
      issuedAt: '2026-08-03',
      lines: [{ itemId: service.id, quantityMilli: 1000, sourceLineId: 's1' }],
      requestId: 'r5',
      idempotencyKey: 'idem-inv2',
    })
    expect(svcIssue.movements).toHaveLength(0)
    expect(svcIssue.cogsPostings).toHaveLength(0)

    const adj = await svc.createAdjustment(admin, {
      id: 'adj-1',
      ...scope,
      itemId: item.id,
      quantityDeltaMilli: -1000,
      reason: 'Stock count write-down',
      adjustedAt: '2026-08-03',
      expectedVersion: afterSale.version,
      requestId: 'r6',
      idempotencyKey: 'idem-adj',
    })
    expect(adj.quantityDeltaMilli).toBe(-1000)
    expect(adj.totalCostMinor).toBe(50_00)
    expect(adj.externalEgressAllowed).toBe(false)

    const report = await svc.stockOnHandReport(admin, scope)
    expect(report.externalEgressAllowed).toBe(false)
    const widgetLine = report.lines.find((l) => l.sku === 'WIDGET-01')
    expect(widgetLine?.quantityOnHandMilli).toBe(5000)
    expect(widgetLine?.inventoryValueMinor).toBe(250_00)

    const bundle = await svc.listBundle(admin, scope)
    expect(bundle.recentAudit.length).toBeGreaterThanOrEqual(4)
    expect(bundle.recentAudit.every((e) => e.externalEgressAllowed === false)).toBe(true)

    // Idempotent invoice re-apply
    const again = await svc.applyInvoiceIssue(admin, {
      id: 'batch-inv-1',
      ...scope,
      invoiceId: 'inv-1',
      issuedAt: '2026-08-02',
      lines: [{ itemId: item.id, quantityMilli: 4000, sourceLineId: 'il1' }],
      requestId: 'r3b',
      idempotencyKey: 'idem-inv',
    })
    expect(again.cogsPostings[0].cogsMinor).toBe(200_00)
    const finalItem = await svc.getItem(admin, scope, item.id)
    expect(finalItem.quantityOnHandMilli).toBe(5000)

    // Duplicate claim on same bill line rejected under new idempotency key
    await expect(svc.applyBillReceipt(admin, {
      id: 'batch-bill-dup',
      ...scope,
      billId: 'bill-1',
      receivedAt: '2026-08-01',
      lines: [{ itemId: item.id, quantityMilli: 1000, unitCostMinor: 10_00, sourceLineId: 'bl1' }],
      requestId: 'r7',
      idempotencyKey: 'idem-bill-dup',
    })).rejects.toThrow(/already applied/i)
  })

  test('insufficient stock on invoice issue fails without mutating qty', async () => {
    const svc = new InMemoryInventoryFinanceService()
    const admin = actor()
    const item = await svc.createItem(admin, {
      id: 'item-low',
      ...scope,
      sku: 'LOW-1',
      name: 'Low',
      incomeAccountId: 'acc-income',
      cogsAccountId: 'acc-cogs',
      inventoryAssetAccountId: 'acc-inv',
      trackQuantity: true,
      openingQuantityMilli: 1000,
      openingUnitCostMinor: 10_00,
      expectedVersion: 0,
      requestId: 'r1',
      idempotencyKey: 'idem-low',
    })
    await expect(svc.applyInvoiceIssue(admin, {
      id: 'batch-fail',
      ...scope,
      invoiceId: 'inv-fail',
      issuedAt: '2026-08-03',
      lines: [{ itemId: item.id, quantityMilli: 2000 }],
      requestId: 'r2',
      idempotencyKey: 'idem-fail',
    })).rejects.toThrow(FinanceValidationError)
    const still = await svc.getItem(admin, scope, item.id)
    expect(still.quantityOnHandMilli).toBe(1000)
    expect(still.inventoryValueMinor).toBe(10_00)
  })
})
