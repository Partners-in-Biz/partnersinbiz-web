import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreFinanceDocumentsGateway,
  type AddReconciliationMatchCommand,
  type AllocatePaymentCommand,
  type ApproveReconciliationCommand,
  type CreateBankAccountCommand,
  type CreateCustomerInvoiceCommand,
  type CreateReconciliationCommand,
  type CreateSupplierBillCommand,
  type ImportBankTransactionCommand,
  type IssueCustomerInvoiceCommand,
  type IssueSupplierBillCommand,
  type ObservePaymentCommand,
  type ReverseAllocationCommand,
  type SubmitReconciliationCommand,
  type VerifyPaymentCommand,
  type VoidCustomerInvoiceCommand,
} from '@/lib/accounting/firestore-documents-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'invoice.create',
  'invoice.issue',
  'invoice.void',
  'supplier-bill.create',
  'supplier-bill.issue',
  'payment.observe',
  'payment.verify',
  'payment.allocate',
  'payment.allocation.reverse',
  'bank-account.create',
  'bank-transaction.import',
  'reconciliation.create',
  'reconciliation.match',
  'reconciliation.submit',
  'reconciliation.approve',
] as const

type DocumentsOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceDocumentsGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/documents/commands',
    execute: async (operation, actor, command) => {
      switch (operation as DocumentsOperation) {
        case 'invoice.create':
          return gateway.createCustomerInvoice(actor, command as unknown as CreateCustomerInvoiceCommand)
        case 'invoice.issue':
          return gateway.issueCustomerInvoice(actor, command as unknown as IssueCustomerInvoiceCommand)
        case 'invoice.void':
          return gateway.voidCustomerInvoice(actor, command as unknown as VoidCustomerInvoiceCommand)
        case 'supplier-bill.create':
          return gateway.createSupplierBill(actor, command as unknown as CreateSupplierBillCommand)
        case 'supplier-bill.issue':
          return gateway.issueSupplierBill(actor, command as unknown as IssueSupplierBillCommand)
        case 'payment.observe':
          return gateway.observePayment(actor, command as unknown as ObservePaymentCommand)
        case 'payment.verify':
          return gateway.verifyPayment(actor, command as unknown as VerifyPaymentCommand)
        case 'payment.allocate':
          return gateway.allocatePayment(actor, command as unknown as AllocatePaymentCommand)
        case 'payment.allocation.reverse':
          return gateway.reverseAllocation(actor, command as unknown as ReverseAllocationCommand)
        case 'bank-account.create':
          return gateway.createBankAccount(actor, command as unknown as CreateBankAccountCommand)
        case 'bank-transaction.import':
          return gateway.importBankTransaction(actor, command as unknown as ImportBankTransactionCommand)
        case 'reconciliation.create':
          return gateway.createReconciliation(actor, command as unknown as CreateReconciliationCommand)
        case 'reconciliation.match':
          return gateway.addReconciliationMatch(actor, command as unknown as AddReconciliationMatchCommand)
        case 'reconciliation.submit':
          return gateway.submitReconciliation(actor, command as unknown as SubmitReconciliationCommand)
        case 'reconciliation.approve':
          return gateway.approveReconciliation(actor, command as unknown as ApproveReconciliationCommand)
      }
    },
  })
})
