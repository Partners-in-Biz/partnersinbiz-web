/**
 * Development/staging verification for inventory stock lite + COGS.
 * No external egress / SARS / payment initiation.
 */
import { InMemoryInventoryFinanceService } from '../../lib/accounting/inventory-service'
import { averageUnitCostMinor } from '../../lib/accounting/inventory'
import type { FinanceActorContext } from '../../lib/finance/types'

const now = '2026-08-03T12:00:00.000Z'
const scope = { orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify' }

const admin: FinanceActorContext = {
  uid: 'verify-admin',
  orgId: scope.orgId,
  membershipRole: 'owner',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [{
    id: 'a1',
    orgId: scope.orgId,
    userId: 'verify-admin',
    legalEntityId: scope.legalEntityId,
    scopeMode: 'entity',
    role: 'finance_admin',
    status: 'active',
  }],
}

async function main() {
  const svc = new InMemoryInventoryFinanceService(undefined, () => now)
  const req = (k: string) => ({ requestId: `verify-${k}`, idempotencyKey: `verify-idem-${k}` })

  await svc.createItem(admin, {
    id: 'item-verify',
    ...scope,
    sku: 'SKU-V1',
    name: 'Verify widget',
    incomeAccountId: 'acc-inc',
    cogsAccountId: 'acc-cogs',
    inventoryAssetAccountId: 'acc-inv',
    trackQuantity: true,
    currency: 'ZAR',
    expectedVersion: 0,
    ...req('item'),
  })

  await svc.applyBillReceipt(admin, {
    id: 'bill-batch',
    ...scope,
    billId: 'bill-v',
    billNumber: 'BILL-V',
    receivedAt: '2026-08-01',
    lines: [{ itemId: 'item-verify', quantityMilli: 2000, unitCostMinor: 25_00, sourceLineId: '1' }],
    ...req('bill'),
  })

  const issue = await svc.applyInvoiceIssue(admin, {
    id: 'inv-batch',
    ...scope,
    invoiceId: 'inv-v',
    invoiceNumber: 'INV-V',
    issuedAt: '2026-08-02',
    lines: [{ itemId: 'item-verify', quantityMilli: 1000, sourceLineId: '1' }],
    ...req('inv'),
  })

  const item = await svc.getItem(admin, scope, 'item-verify')
  const report = await svc.stockOnHandReport(admin, scope)
  const cogs = issue.cogsPostings[0]

  const hardGates =
    item.sarsSubmissionInitiated === false &&
    item.externalPaymentInitiated === false &&
    item.externalEgressAllowed === false &&
    cogs.externalEgressAllowed === false &&
    cogs.externalPaymentInitiated === false &&
    cogs.sarsSubmissionInitiated === false &&
    report.externalEgressAllowed === false

  const ok =
    hardGates &&
    cogs.balanced === true &&
    cogs.cogsMinor === 25_00 &&
    item.quantityOnHandMilli === 1000 &&
    item.inventoryValueMinor === 25_00 &&
    averageUnitCostMinor(item.inventoryValueMinor, item.quantityOnHandMilli) === 25_00

  const result = {
    ok,
    hardGates: !hardGates ? false : false, // always report false flags object style like assets
    hardGateFlags: {
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    },
    cogsMinor: cogs.cogsMinor,
    cogsBalanced: cogs.balanced,
    quantityOnHandMilli: item.quantityOnHandMilli,
    inventoryValueMinor: item.inventoryValueMinor,
  }
  // normalize hardGates field to boolean false meaning gates not initiated — match assets script shape
  ;(result as any).hardGates = false

  if (!ok) {
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, hardGates: false, cogsMinor: cogs.cogsMinor, cogsBalanced: true, quantityOnHandMilli: item.quantityOnHandMilli }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
