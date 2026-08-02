import { FinanceDocumentsService, InMemoryDocumentsStore } from '@/lib/accounting/documents-service'
import { ArApDepthService, InMemoryArApDepthStore } from '@/lib/accounting/ar-ap-depth-service'
import { immutableContentHash } from '@/lib/accounting/foundation'
import type { FinanceActorContext } from '@/lib/finance/types'
import type { TaxCode, TaxRuleVersion } from '@/lib/accounting/tax-types'

const now = '2026-07-30T10:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

const actor: FinanceActorContext = {
  uid: 'finance-admin', orgId: 'org-a', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'admin-assignment', orgId: 'org-a', userId: 'finance-admin', legalEntityId: 'entity-a', scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}

function seedTax(docs: FinanceDocumentsService) {
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
  docs.registerTaxCode(taxCode)
  docs.registerTaxRule({ ...ruleBase, contentHash: immutableContentHash(ruleBase) } as TaxRuleVersion)
}

function makeDepth() {
  const docsStore = new InMemoryDocumentsStore()
  const docsService = new FinanceDocumentsService(docsStore, () => now)
  const depthStore = new InMemoryArApDepthStore()
  const depth = new ArApDepthService(docsStore, docsService, depthStore, () => now)
  seedTax(docsService)
  return { docsStore, docsService, depthStore, depth }
}

describe('AR/AP depth service golden path', () => {
  test('invoice → partial pay → credit note → statement totals', async () => {
    const { docsStore, docsService, depthStore, depth } = makeDepth()

    const invoice = await docsService.createCustomerInvoice(actor, {
      ...scope, id: 'inv-depth-1', customerCompanyId: 'cust-1',
      customerSnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd', vatNumber: '4123456789' },
      issueDate: '2026-07-10', dueDate: '2026-07-31', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'il1', description: 'Platform retainer', quantityMilli: 1000, unitPriceMinor: 10_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
      expectedVersion: 0, ...request('inv-create'),
    })
    await docsService.issueCustomerInvoice(actor, {
      ...scope, invoiceId: invoice.id, expectedVersion: invoice.version, controlAccountId: 'ar', ...request('inv-issue'),
    })

    const receipt = await docsService.observePayment(actor, {
      ...scope, id: 'pay-partial', direction: 'receipt', amountMinor: 5_000, currency: 'ZAR',
      observedDate: '2026-07-20', effectiveDate: '2026-07-20', method: 'eft', sourceEventKey: 'provider:partial-1',
      counterpartyCompanyId: 'cust-1', expectedVersion: 0, ...request('pay-partial'),
    })
    await docsService.allocatePayment(actor, {
      ...scope, id: 'alloc-partial', paymentId: receipt.id, targetType: 'customer_invoice', targetId: invoice.id,
      allocatedMinor: 5_000, expectedVersion: 0, ...request('alloc-partial'),
    })
    expect(docsStore.invoices.get(invoice.id)?.status).toBe('partially_paid')
    expect(docsStore.invoices.get(invoice.id)?.outstandingMinor).toBe(6_500)

    const credit = await depth.createCustomerCreditNote(actor, {
      ...scope, id: 'cn-1', customerCompanyId: 'cust-1',
      customerSnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd' }, relatedInvoiceId: invoice.id,
      issueDate: '2026-07-22', currency: 'ZAR', accountingBasis: 'accrual', reason: 'Service credit',
      lines: [{ id: 'cnl1', description: 'Goodwill credit', quantityMilli: 1000, unitPriceMinor: 1_500, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
      expectedVersion: 0, ...request('cn-create'),
    })
    expect(credit.totalMinor).toBe(1_725)
    expect(credit.massEmailAllowed).toBe(false)
    await depth.issueCustomerCreditNote(actor, {
      ...scope, creditNoteId: credit.id, expectedVersion: credit.version, ...request('cn-issue'),
    })
    await depth.applyCustomerCreditNote(actor, {
      ...scope, id: 'cna-1', creditNoteId: credit.id, invoiceId: invoice.id, appliedMinor: 1_725, expectedVersion: 0, ...request('cn-apply'),
    })
    expect(depthStore.creditNotes.get(credit.id)?.status).toBe('applied')
    expect(docsStore.invoices.get(invoice.id)?.outstandingMinor).toBe(4_775)

    const statement = await depth.createCounterpartyStatement(actor, {
      ...scope, id: 'stmt-1', role: 'customer', counterpartyCompanyId: 'cust-1',
      counterpartySnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd' },
      fromDate: '2026-07-01', toDate: '2026-07-31', currency: 'ZAR', exportFormat: 'csv', expectedVersion: 0, ...request('stmt'),
    })
    expect(statement.massEmailAllowed).toBe(false)
    expect(statement.autoSend).toBe(false)
    expect(statement.externalEgressAllowed).toBe(false)
    expect(statement.closingBalanceMinor).toBe(4_775)

    const aging = depth.buildAgingReport(actor, { ...scope, role: 'customer', asOfDate: '2026-08-15', currency: 'ZAR' })
    expect(aging.totalOutstandingMinor).toBe(4_775)

    const schedule = await depth.createRecurringSchedule(actor, {
      ...scope, id: 'rec-1', documentKind: 'customer_invoice', name: 'Monthly retainer', frequency: 'monthly', startDate: '2026-08-01',
      template: {
        counterpartyCompanyId: 'cust-1', counterpartySnapshot: { companyId: 'cust-1', legalName: 'Acme (Pty) Ltd' },
        currency: 'ZAR', accountingBasis: 'accrual', dueDays: 30,
        lines: [{ id: 'rl1', description: 'Monthly retainer', quantityMilli: 1000, unitPriceMinor: 10_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue' }],
      },
      expectedVersion: 0, ...request('rec-create'),
    })
    const generated = await depth.generateRecurringSchedule(actor, {
      ...scope, scheduleId: schedule.id, expectedVersion: schedule.version, documentId: 'inv-rec-1', ...request('rec-gen'),
    })
    expect(generated.schedule.nextRunDate).toBe('2026-09-01')

    await depth.addDocumentAttachment(actor, {
      ...scope, id: 'att-1', parentType: 'customer_invoice', parentId: invoice.id, fileName: 'po.pdf',
      contentType: 'application/pdf', byteSize: 2048, storageRef: 'org-a/entity-a/book-a/invoices/inv-depth-1/po.pdf',
      expectedVersion: 0, ...request('att'),
    })

    const bulk = await depth.bulkIssueDocuments(actor, {
      ...scope, id: 'bulk-1',
      targets: [{ type: 'customer_invoice', id: 'inv-rec-1', expectedVersion: docsStore.invoices.get('inv-rec-1')!.version, controlAccountId: 'ar' }],
      ...request('bulk-issue'),
    })
    expect(bulk.results[0]?.status).toBe('issued')
    expect(depthStore.auditEvents.every((event) => event.externalEgressAllowed === false)).toBe(true)
  })

  test('supplier debit note applies against bill and bulk allocate works', async () => {
    const { docsStore, docsService, depth } = makeDepth()

    const bill = await docsService.createSupplierBill(actor, {
      ...scope, id: 'bill-depth-1', supplierCompanyId: 'sup-1',
      supplierSnapshot: { companyId: 'sup-1', legalName: 'Office Supplies Co' }, supplierReference: 'SUP-DEPTH-1',
      issueDate: '2026-07-12', receivedDate: '2026-07-13', dueDate: '2026-08-12', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'bl1', description: 'Stationery', quantityMilli: 1000, unitPriceMinor: 2_000, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'expense' }],
      expectedVersion: 0, ...request('bill-create'),
    })
    await docsService.issueSupplierBill(actor, {
      ...scope, billId: bill.id, expectedVersion: bill.version, controlAccountId: 'ap', ...request('bill-issue'),
    })

    const debit = await depth.createSupplierDebitNote(actor, {
      ...scope, id: 'dn-1', supplierCompanyId: 'sup-1', supplierSnapshot: { companyId: 'sup-1', legalName: 'Office Supplies Co' },
      relatedBillId: bill.id, issueDate: '2026-07-18', currency: 'ZAR', accountingBasis: 'accrual',
      lines: [{ id: 'dnl1', description: 'Return credit', quantityMilli: 1000, unitPriceMinor: 500, taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'expense' }],
      expectedVersion: 0, ...request('dn-create'),
    })
    await depth.issueSupplierDebitNote(actor, {
      ...scope, debitNoteId: debit.id, expectedVersion: debit.version, ...request('dn-issue'),
    })
    await depth.applySupplierDebitNote(actor, {
      ...scope, id: 'dna-1', debitNoteId: debit.id, billId: bill.id, appliedMinor: debit.totalMinor, expectedVersion: 0, ...request('dn-apply'),
    })
    expect(docsStore.bills.get(bill.id)?.outstandingMinor).toBe(2_300 - debit.totalMinor)

    const payment = await docsService.observePayment(actor, {
      ...scope, id: 'pay-ap', direction: 'disbursement', amountMinor: 500, currency: 'ZAR',
      observedDate: '2026-07-25', effectiveDate: '2026-07-25', method: 'eft', sourceEventKey: 'manual:ap-1',
      counterpartyCompanyId: 'sup-1', expectedVersion: 0, ...request('pay-ap'),
    })
    const bulkAlloc = await depth.bulkAllocatePayments(actor, {
      ...scope, id: 'bulk-alloc-1',
      allocations: [{ id: 'alloc-ap-1', paymentId: payment.id, targetType: 'supplier_bill', targetId: bill.id, allocatedMinor: 500 }],
      ...request('bulk-alloc'),
    })
    expect(bulkAlloc.results).toHaveLength(1)
    expect(docsStore.payments.get(payment.id)?.unallocatedMinor).toBe(0)
  })
})
