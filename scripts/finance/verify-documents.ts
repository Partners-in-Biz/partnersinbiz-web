/**
 * Development/staging verification for invoices, supplier bills,
 * payment matching, and bank/cash reconciliation.
 * Records money movement only — no external payment initiation or egress.
 */
import { FinanceDocumentsService, InMemoryDocumentsStore } from '../../lib/accounting/documents-service'
import { immutableContentHash } from '../../lib/accounting/foundation'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '../../lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '../../lib/finance/types'
import type { TaxCode, TaxRuleVersion } from '../../lib/accounting/tax-types'

const now = '2026-07-30T12:00:00.000Z'
const request = (key: string) => ({ requestId: `verify-${key}`, idempotencyKey: `verify-idem-${key}` })
const scope = { orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify' }

const actor: FinanceActorContext = {
  uid: 'verify-admin', orgId: 'org-verify', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'a1', orgId: 'org-verify', userId: 'verify-admin', legalEntityId: 'entity-verify', scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}
const approver: FinanceActorContext = {
  ...actor, uid: 'verify-approver', membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'a2', userId: 'verify-approver', role: 'finance_approver' }],
}

function makeApproval(partial: Pick<FinanceApprovalRecord, 'id' | 'action' | 'reason'>): FinanceApprovalRecord {
  const base = {
    ...scope, id: partial.id, schemaVersion: 1 as const, action: partial.action, status: 'approved' as const,
    approvedBy: approver.uid, approverRole: 'finance_approver' as const, approverAssignmentId: 'a2',
    approvedAt: now, reason: partial.reason, subjectDigest: canonicalDigest({ id: partial.id, action: partial.action }),
    immutable: true as const, canonicalPayloadVersion: 1 as const, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

function seedTax(service: FinanceDocumentsService) {
  const taxCode: TaxCode = {
    ...scope, id: 'tax-za-std', code: 'ZA-STD', name: 'Standard VAT', jurisdictionCode: 'ZA',
    category: 'output_vat', recoverability: 'full', active: true, schemaVersion: 1, version: 1,
    createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system',
  }
  const ruleBase = {
    ...scope, id: 'rule-za-std', taxCodeId: 'tax-za-std', jurisdictionCode: 'ZA', versionNumber: 1,
    rateBasisPoints: 1500, rateNumerator: 15, rateDenominator: 100, roundingMode: 'half_up' as const,
    taxPointPolicyId: 'za-invoice', effectiveFrom: '2026-07-01', status: 'approved' as const,
    sourceCitation: 'SARS VAT 15%', sourceChecksum: 'za-vat-15', immutable: true, schemaVersion: 1 as const, version: 1,
    createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system',
  }
  service.registerTaxCode(taxCode)
  service.registerTaxRule({ ...ruleBase, contentHash: immutableContentHash(ruleBase) } as TaxRuleVersion)
}

async function main() {
  const store = new InMemoryDocumentsStore()
  const service = new FinanceDocumentsService(store, () => now)
  seedTax(service)

  const invoice = await service.createCustomerInvoice(actor, {
    ...scope, id: 'inv-verify', customerCompanyId: 'cust-1',
    customerSnapshot: { companyId: 'cust-1', legalName: 'Verify Customer' },
    issueDate: '2026-07-10', dueDate: '2026-07-31', currency: 'ZAR', accountingBasis: 'accrual',
    lines: [{ id: 'l1', description: 'Service', quantityMilli: 1000, unitPriceMinor: 10_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
    expectedVersion: 0, ...request('inv'),
  })
  if (invoice.totalMinor !== 11_500 || invoice.taxMinor !== 1_500) throw new Error('invoice VAT totals mismatch')

  const issued = await service.issueCustomerInvoice(actor, {
    ...scope, invoiceId: invoice.id, expectedVersion: invoice.version, controlAccountId: 'ar',
    issueJournalEntryId: 'j-issue', ...request('inv-issue'),
  })

  const bill = await service.createSupplierBill(actor, {
    ...scope, id: 'bill-verify', supplierCompanyId: 'sup-1',
    supplierSnapshot: { companyId: 'sup-1', legalName: 'Verify Supplier' }, supplierReference: 'VR-1',
    issueDate: '2026-07-11', receivedDate: '2026-07-12', dueDate: '2026-08-11', currency: 'ZAR', accountingBasis: 'accrual',
    lines: [{ id: 'bl1', description: 'Supplies', quantityMilli: 1000, unitPriceMinor: 1_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'expense' }],
    expectedVersion: 0, ...request('bill'),
  })
  await service.issueSupplierBill(actor, {
    ...scope, billId: bill.id, expectedVersion: bill.version, controlAccountId: 'ap', ...request('bill-issue'),
  })

  await service.createBankAccount(actor, {
    ...scope, id: 'bank-verify', code: 'MAIN', name: 'Main', currency: 'ZAR', ledgerAccountId: 'cash',
    expectedVersion: 0, ...request('bank'),
  })

  const payment = await service.observePayment(actor, {
    ...scope, id: 'pay-verify', direction: 'receipt', amountMinor: 11_500, currency: 'ZAR',
    observedDate: '2026-07-20', effectiveDate: '2026-07-20', method: 'eft', sourceEventKey: 'verify:evt-1',
    bankAccountId: 'bank-verify', expectedVersion: 0, ...request('pay'),
  })
  if (payment.externalPaymentInitiated !== false) throw new Error('payment must not initiate external rails')

  await service.allocatePayment(actor, {
    ...scope, id: 'alloc-verify', paymentId: payment.id, targetType: 'customer_invoice', targetId: invoice.id,
    allocatedMinor: 11_500, expectedVersion: 0, ...request('alloc'),
  })
  if (store.invoices.get(invoice.id)?.status !== 'paid') throw new Error('invoice not fully paid')

  const bankTxn = await service.importBankTransaction(actor, {
    ...scope, id: 'btx-verify', bankAccountId: 'bank-verify', statementDate: '2026-07-20', effectiveDate: '2026-07-20',
    amountMinor: 11_500, description: 'Customer EFT', sourceFingerprint: 'verify-fp-1', expectedVersion: 0, ...request('btx'),
  })

  const recon = await service.createReconciliation(actor, {
    ...scope, id: 'recon-verify', bankAccountId: 'bank-verify', statementStartsAt: '2026-07-01', statementEndsAt: '2026-07-31',
    openingBalanceMinor: 0, closingBalanceMinor: 11_500, expectedVersion: 0, ...request('recon'),
  })
  await service.addReconciliationMatch(actor, {
    ...scope, id: 'rm-verify', reconciliationId: recon.id, bankTransactionId: bankTxn.id, paymentId: payment.id,
    matchedMinor: 11_500, expectedVersion: 0, ...request('rm'),
  })
  const submitted = await service.submitReconciliation(actor, {
    ...scope, reconciliationId: recon.id, expectedVersion: store.reconciliations.get(recon.id)!.version, ...request('recon-submit'),
  })
  service.registerApproval(makeApproval({ id: 'ap-recon', action: 'reconciliation.approve', reason: 'balanced' }))
  const approved = await service.approveReconciliation(actor, {
    ...scope, reconciliationId: recon.id, expectedVersion: submitted.version, approvalId: 'ap-recon', reason: 'Lock', ...request('recon-approve'),
  })
  if (approved.status !== 'approved' || approved.differenceMinor !== 0) throw new Error('reconciliation not approved balanced')
  if (store.auditEvents.length < 8) throw new Error(`expected audit trail, got ${store.auditEvents.length}`)
  if (store.auditEvents.some((event) => event.externalEgressAllowed !== false)) throw new Error('audit egress must be false')

  console.log(JSON.stringify({
    ok: true,
    invoiceNumber: issued.documentNumber,
    invoiceTotalMinor: issued.totalMinor,
    invoiceStatus: store.invoices.get(invoice.id)?.status,
    billNumber: store.bills.get(bill.id)?.documentNumber,
    billOutstandingMinor: store.bills.get(bill.id)?.outstandingMinor,
    paymentUnallocatedMinor: store.payments.get(payment.id)?.unallocatedMinor,
    externalPaymentInitiated: payment.externalPaymentInitiated,
    reconciliationStatus: approved.status,
    reconciliationDifferenceMinor: approved.differenceMinor,
    auditEvents: store.auditEvents.length,
    noEgress: true,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
