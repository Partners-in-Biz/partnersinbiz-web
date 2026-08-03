/**
 * Development verification for expense claims (SA bookkeepers).
 * No payment initiate, no SARS, no auto OCR post, no prod deploy.
 */
import assert from 'assert'
import {
  ExpenseClaimFinanceService,
  createEmptyExpenseClaimStore,
  type ExpenseClaimStore,
} from '../../lib/finance/expense-claims/service'
import type { FinanceActorContext } from '../../lib/finance/types'

function actor(uid: string, orgId: string, financeRole: string = 'finance_admin'): FinanceActorContext {
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
        scopeMode: 'entity',
        role: financeRole as any,
        status: 'active',
      },
    ],
  }
}

async function main() {
  const storeRef: { current: ExpenseClaimStore } = { current: createEmptyExpenseClaimStore() }
  const svc = new ExpenseClaimFinanceService(
    async () => storeRef.current,
    async (_b, a) => {
      storeRef.current = a
    },
    () => '2026-08-03T12:00:00.000Z',
  )
  const bk = actor('bk', 'org_verify_exc', 'bookkeeper')
  const mgr = actor('mgr', 'org_verify_exc', 'finance_approver')

  await svc.createClaim(bk, {
    id: 'c1',
    orgId: 'org_verify_exc',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    payeeName: 'Verify User',
    employeeId: 'emp_1',
    claimDate: '2026-08-01',
    vendor: 'Engen',
    policyNotes: 'policy ok',
    lines: [
      {
        id: 'l1',
        description: 'Fuel',
        expenseAccountId: 'acc_travel',
        netMinor: 850_00,
        taxRateCode: 'za_std_15',
      },
    ],
    requestId: '1',
    idempotencyKey: 'c',
  })
  await svc.attachReceipt(bk, {
    id: 'r1',
    orgId: 'org_verify_exc',
    claimId: 'c1',
    fileName: 'engen.pdf',
    contentType: 'application/pdf',
    storageRefId: 's1',
    requestId: '2',
    idempotencyKey: 'r',
  })
  const ocr = await svc.runOcrAssist(bk, {
    id: 'o1',
    orgId: 'org_verify_exc',
    claimId: 'c1',
    receiptId: 'r1',
    requestId: '3',
    idempotencyKey: 'o',
  })
  assert.strictEqual(ocr.autoApplied, false)
  assert.strictEqual(ocr.autoPosted, false)
  await svc.submitClaim(bk, { id: 'c1', orgId: 'org_verify_exc', requestId: '4', idempotencyKey: 's' })
  await svc.approveClaim(mgr, {
    id: 'c1',
    orgId: 'org_verify_exc',
    note: 'ok',
    requestId: '5',
    idempotencyKey: 'a',
  })
  const posted = await svc.postClaim(mgr, {
    id: 'c1',
    orgId: 'org_verify_exc',
    postTarget: 'payable',
    creditAccountId: 'acc_pay',
    vatControlAccountId: 'acc_vat',
    requestId: '6',
    idempotencyKey: 'p',
  })
  assert.strictEqual(posted.journalProposal?.balanced, true)
  assert.strictEqual(posted.externalPaymentInitiated, false)
  assert.strictEqual(posted.autoPosted, false)
  const exp = await svc.exportPaymentInstruction(mgr, {
    id: 'pack',
    orgId: 'org_verify_exc',
    claimId: 'c1',
    requestId: '7',
    idempotencyKey: 'e',
  })
  assert.strictEqual(exp.paymentInstructionExport?.externalPaymentInitiated, false)
  const bundle = await svc.getBundle(mgr, 'org_verify_exc', 'le_1', 'book_1')
  assert.deepStrictEqual(bundle.hardGates, {
    externalPaymentInitiated: false,
    externalEgressAllowed: false,
    sarsSubmissionInitiated: false,
    autoPosted: false,
    ocrAutoApplied: false,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        claimStatus: exp.status,
        balanced: true,
        vatTotalMinor: posted.vatTotalMinor,
        grossTotalMinor: posted.grossTotalMinor,
        ocrAutoApplied: false,
        externalPaymentInitiated: false,
        autoPosted: false,
        sarsSubmissionInitiated: false,
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
