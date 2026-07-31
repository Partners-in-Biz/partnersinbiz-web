import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'
import { immutableContentHash } from '@/lib/accounting/foundation'
import { FinanceDocumentsService, InMemoryDocumentsStore } from '@/lib/accounting/documents-service'
import type { TaxCode, TaxRuleVersion } from '@/lib/accounting/tax-types'

const now = '2026-07-30T10:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

const actor: FinanceActorContext = {
  uid: 'finance-admin', orgId: 'org-a', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'admin-assignment', orgId: 'org-a', userId: 'finance-admin', legalEntityId: 'entity-a', scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}
const approver: FinanceActorContext = {
  ...actor, uid: 'approver', membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'approver-assignment', userId: 'approver', role: 'finance_approver' }],
}

function approval(partial: Pick<FinanceApprovalRecord, 'id' | 'action' | 'reason'>): FinanceApprovalRecord {
  const base = {
    ...scope, id: partial.id, schemaVersion: 1 as const, action: partial.action, status: 'approved' as const,
    approvedBy: approver.uid, approverRole: 'finance_approver' as const, approverAssignmentId: 'approver-assignment',
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
  service.registerTaxRule({ ...ruleBase, contentHash: immutableContentHash(ruleBase) })
}

describe('finance documents service', () => {
  test('issues invoice and bill, matches payment, and approves balanced reconciliation', async () => {
    const store = new InMemoryDocumentsStore()
    const service = new FinanceDocumentsService(store, () => now)
    seedTax(service)

    const invoice = await service.createCustomerInvoice(actor, {
      ...scope, id: 'inv-1', customerCompanyId: 'cust-1',
      customerSnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd', vatNumber: '4123456789' },
      issueDate: '2026-07-10', dueDate: '2026-07-31', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'il1', description: 'Platform retainer', quantityMilli: 1000, unitPriceMinor: 10_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
      expectedVersion: 0, ...request('inv-create'),
    })
    expect(invoice.documentNumber).toBe('INV-000001')
    expect(invoice.totalMinor).toBe(11_500)

    const issuedInvoice = await service.issueCustomerInvoice(actor, {
      ...scope, invoiceId: invoice.id, expectedVersion: invoice.version, controlAccountId: 'ar',
      issueJournalEntryId: 'j-inv-issue', ...request('inv-issue'),
    })
    expect(issuedInvoice.status).toBe('issued')
    expect(issuedInvoice.openItemId).toBe('oi_inv-1')

    const bill = await service.createSupplierBill(actor, {
      ...scope, id: 'bill-1', supplierCompanyId: 'sup-1',
      supplierSnapshot: { companyId: 'sup-1', legalName: 'Office Supplies Co' }, supplierReference: 'SUP-778',
      issueDate: '2026-07-12', receivedDate: '2026-07-13', dueDate: '2026-08-12', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'bl1', description: 'Stationery', quantityMilli: 1000, unitPriceMinor: 2_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'expense' }],
      expectedVersion: 0, ...request('bill-create'),
    })
    await service.issueSupplierBill(actor, {
      ...scope, billId: bill.id, expectedVersion: bill.version, controlAccountId: 'ap', ...request('bill-issue'),
    })

    await service.createBankAccount(actor, {
      ...scope, id: 'bank-1', code: 'FNB-MAIN', name: 'FNB Main', currency: 'ZAR', ledgerAccountId: 'cash',
      maskedAccountNumber: '****1234', expectedVersion: 0, ...request('bank'),
    })

    const receipt = await service.observePayment(actor, {
      ...scope, id: 'pay-receipt', direction: 'receipt', amountMinor: 11_500, currency: 'ZAR',
      observedDate: '2026-07-20', effectiveDate: '2026-07-20', method: 'eft', sourceEventKey: 'provider:evt-1',
      bankAccountId: 'bank-1', counterpartyCompanyId: 'cust-1', expectedVersion: 0, ...request('pay-receipt'),
    })
    expect(receipt.status).toBe('verified')
    expect(receipt.externalPaymentInitiated).toBe(false)

    await service.allocatePayment(actor, {
      ...scope, id: 'alloc-1', paymentId: receipt.id, targetType: 'customer_invoice', targetId: invoice.id,
      allocatedMinor: 11_500, settlementJournalEntryId: 'j-settle-inv', expectedVersion: 0, ...request('alloc-1'),
    })
    expect(store.invoices.get(invoice.id)?.status).toBe('paid')
    expect(store.invoices.get(invoice.id)?.outstandingMinor).toBe(0)
    expect(store.payments.get(receipt.id)?.unallocatedMinor).toBe(0)

    const disbursement = await service.observePayment(actor, {
      ...scope, id: 'pay-disb', direction: 'disbursement', amountMinor: 1_000, currency: 'ZAR',
      observedDate: '2026-07-21', effectiveDate: '2026-07-21', method: 'eft', sourceEventKey: 'manual:disb-1',
      bankAccountId: 'bank-1', expectedVersion: 0, ...request('pay-disb'),
    })
    await service.allocatePayment(actor, {
      ...scope, id: 'alloc-2', paymentId: disbursement.id, targetType: 'supplier_bill', targetId: bill.id,
      allocatedMinor: 1_000, expectedVersion: 0, ...request('alloc-2'),
    })
    expect(store.bills.get(bill.id)?.status).toBe('partially_paid')
    expect(store.bills.get(bill.id)?.outstandingMinor).toBe(1_300)

    const bankTxn = await service.importBankTransaction(actor, {
      ...scope, id: 'btx-1', bankAccountId: 'bank-1', statementDate: '2026-07-20', effectiveDate: '2026-07-20',
      amountMinor: 11_500, description: 'Customer receipt', sourceFingerprint: 'stmt:2026-07:1',
      expectedVersion: 0, ...request('btx-1'),
    })

    const recon = await service.createReconciliation(actor, {
      ...scope, id: 'recon-1', bankAccountId: 'bank-1', statementStartsAt: '2026-07-01', statementEndsAt: '2026-07-31',
      openingBalanceMinor: 0, closingBalanceMinor: 11_500, expectedVersion: 0, ...request('recon-create'),
    })
    await service.addReconciliationMatch(actor, {
      ...scope, id: 'rm-1', reconciliationId: recon.id, bankTransactionId: bankTxn.id, paymentId: receipt.id,
      matchedMinor: 11_500, expectedVersion: 0, ...request('recon-match'),
    })
    const submitted = await service.submitReconciliation(actor, {
      ...scope, reconciliationId: recon.id, expectedVersion: store.reconciliations.get(recon.id)!.version, ...request('recon-submit'),
    })
    expect(submitted.differenceMinor).toBe(0)
    service.registerApproval(approval({ id: 'ap-recon', action: 'reconciliation.approve', reason: 'Statement balanced' }))
    const approved = await service.approveReconciliation(actor, {
      ...scope, reconciliationId: recon.id, expectedVersion: submitted.version, approvalId: 'ap-recon',
      reason: 'Lock reconciliation', ...request('recon-approve'),
    })
    expect(approved.status).toBe('approved')

    const again = await service.createCustomerInvoice(actor, {
      ...scope, id: 'inv-1', customerCompanyId: 'cust-1',
      customerSnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd', vatNumber: '4123456789' },
      issueDate: '2026-07-10', dueDate: '2026-07-31', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'il1', description: 'Platform retainer', quantityMilli: 1000, unitPriceMinor: 10_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
      expectedVersion: 0, ...request('inv-create'),
    })
    expect(again.id).toBe(invoice.id)
    expect(store.auditEvents.every((event) => event.externalEgressAllowed === false)).toBe(true)
  })

  test('rejects over-allocation and duplicate supplier references', async () => {
    const store = new InMemoryDocumentsStore()
    const service = new FinanceDocumentsService(store, () => now)
    seedTax(service)
    const invoice = await service.createCustomerInvoice(actor, {
      ...scope, id: 'inv-2', customerCompanyId: 'cust-1', customerSnapshot: { companyId: 'cust-1', legalName: 'Acme' },
      issueDate: '2026-07-10', dueDate: '2026-07-31', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'il1', description: 'Work', quantityMilli: 1000, unitPriceMinor: 1_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
      expectedVersion: 0, ...request('inv2-create'),
    })
    await service.issueCustomerInvoice(actor, {
      ...scope, invoiceId: invoice.id, expectedVersion: 1, controlAccountId: 'ar', ...request('inv2-issue'),
    })
    const payment = await service.observePayment(actor, {
      ...scope, id: 'pay-2', direction: 'receipt', amountMinor: 500, currency: 'ZAR',
      observedDate: '2026-07-20', effectiveDate: '2026-07-20', method: 'cash', sourceEventKey: 'cash:1',
      expectedVersion: 0, ...request('pay2'),
    })
    await expect(service.allocatePayment(actor, {
      ...scope, id: 'alloc-over', paymentId: payment.id, targetType: 'customer_invoice', targetId: invoice.id,
      allocatedMinor: 1_000, expectedVersion: 0, ...request('alloc-over'),
    })).rejects.toThrow('payment unallocated')

    await service.createSupplierBill(actor, {
      ...scope, id: 'bill-a', supplierCompanyId: 'sup-1', supplierSnapshot: { companyId: 'sup-1', legalName: 'Supplier' },
      supplierReference: 'DUP-1', issueDate: '2026-07-12', receivedDate: '2026-07-13', dueDate: '2026-08-12',
      currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'bl1', description: 'Item', quantityMilli: 1000, unitPriceMinor: 100, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'expense' }],
      expectedVersion: 0, ...request('bill-a'),
    })
    await expect(service.createSupplierBill(actor, {
      ...scope, id: 'bill-b', supplierCompanyId: 'sup-1', supplierSnapshot: { companyId: 'sup-1', legalName: 'Supplier' },
      supplierReference: 'DUP-1', issueDate: '2026-07-12', receivedDate: '2026-07-13', dueDate: '2026-08-12',
      currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'bl1', description: 'Item', quantityMilli: 1000, unitPriceMinor: 100, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'expense' }],
      expectedVersion: 0, ...request('bill-b'),
    })).rejects.toThrow('Supplier reference already exists')
  })

  test('rejects approving reconciliation with unmatched difference', async () => {
    const store = new InMemoryDocumentsStore()
    const service = new FinanceDocumentsService(store, () => now)
    await service.createBankAccount(actor, {
      ...scope, id: 'bank-2', code: 'CASH', name: 'Cash', currency: 'ZAR', ledgerAccountId: 'cash',
      expectedVersion: 0, ...request('bank2'),
    })
    const recon = await service.createReconciliation(actor, {
      ...scope, id: 'recon-2', bankAccountId: 'bank-2', statementStartsAt: '2026-07-01', statementEndsAt: '2026-07-31',
      openingBalanceMinor: 0, closingBalanceMinor: 100, expectedVersion: 0, ...request('recon2'),
    })
    const submitted = await service.submitReconciliation(actor, {
      ...scope, reconciliationId: recon.id, expectedVersion: recon.version, ...request('recon2-submit'),
    })
    service.registerApproval(approval({ id: 'ap-recon-2', action: 'reconciliation.approve', reason: 'nope' }))
    await expect(service.approveReconciliation(actor, {
      ...scope, reconciliationId: recon.id, expectedVersion: submitted.version, approvalId: 'ap-recon-2',
      reason: 'force', ...request('recon2-approve'),
    })).rejects.toThrow('difference must be zero')
  })
})
