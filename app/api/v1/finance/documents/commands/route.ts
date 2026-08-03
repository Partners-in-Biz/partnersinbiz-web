import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreFinanceDocumentsGateway,
  type AddDocumentAttachmentCommand,
  type AddReconciliationMatchCommand,
  type AllocatePaymentCommand,
  type ApplyCustomerCreditNoteCommand,
  type ApplySupplierDebitNoteCommand,
  type ApproveReconciliationCommand,
  type BulkAllocatePaymentsCommand,
  type BulkIssueDocumentsCommand,
  type BulkVoidDocumentsCommand,
  type CreateBankAccountCommand,
  type CreateCounterpartyStatementCommand,
  type CreateCustomerCreditNoteCommand,
  type CreateCustomerInvoiceCommand,
  type CreateRecurringScheduleCommand,
  type CreateReconciliationCommand,
  type CreateSupplierBillCommand,
  type CreateSupplierDebitNoteCommand,
  type GenerateRecurringScheduleCommand,
  type ImportBankTransactionCommand,
  type IssueCustomerCreditNoteCommand,
  type IssueCustomerInvoiceCommand,
  type IssueSupplierBillCommand,
  type IssueSupplierDebitNoteCommand,
  type ObservePaymentCommand,
  type PauseRecurringScheduleCommand,
  type ReverseAllocationCommand,
  type SubmitReconciliationCommand,
  type VerifyPaymentCommand,
  type VoidCustomerCreditNoteCommand,
  type VoidCustomerInvoiceCommand,
  type VoidSupplierDebitNoteCommand,
} from '@/lib/accounting/firestore-documents-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'invoice.create', 'invoice.issue', 'invoice.void',
  'supplier-bill.create', 'supplier-bill.issue',
  'credit-note.create', 'credit-note.issue', 'credit-note.apply', 'credit-note.void',
  'debit-note.create', 'debit-note.issue', 'debit-note.apply', 'debit-note.void',
  'recurring.create', 'recurring.generate', 'recurring.pause',
  'statement.draft',
  'documents.bulk-issue', 'documents.bulk-void', 'documents.bulk-allocate',
  'attachment.add',
  'payment.observe', 'payment.verify', 'payment.allocate', 'payment.allocation.reverse',
  'bank-account.create', 'bank-transaction.import',
  'reconciliation.create', 'reconciliation.match', 'reconciliation.submit', 'reconciliation.approve',
] as const

type DocumentsOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceDocumentsGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/documents/commands',
    execute: async (operation, actor, command) => {
      switch (operation as DocumentsOperation) {
        case 'invoice.create': return gateway.createCustomerInvoice(actor, command as unknown as CreateCustomerInvoiceCommand)
        case 'invoice.issue': return gateway.issueCustomerInvoice(actor, command as unknown as IssueCustomerInvoiceCommand)
        case 'invoice.void': return gateway.voidCustomerInvoice(actor, command as unknown as VoidCustomerInvoiceCommand)
        case 'supplier-bill.create': return gateway.createSupplierBill(actor, command as unknown as CreateSupplierBillCommand)
        case 'supplier-bill.issue': return gateway.issueSupplierBill(actor, command as unknown as IssueSupplierBillCommand)
        case 'credit-note.create': return gateway.createCustomerCreditNote(actor, command as unknown as CreateCustomerCreditNoteCommand)
        case 'credit-note.issue': return gateway.issueCustomerCreditNote(actor, command as unknown as IssueCustomerCreditNoteCommand)
        case 'credit-note.apply': return gateway.applyCustomerCreditNote(actor, command as unknown as ApplyCustomerCreditNoteCommand)
        case 'credit-note.void': return gateway.voidCustomerCreditNote(actor, command as unknown as VoidCustomerCreditNoteCommand)
        case 'debit-note.create': return gateway.createSupplierDebitNote(actor, command as unknown as CreateSupplierDebitNoteCommand)
        case 'debit-note.issue': return gateway.issueSupplierDebitNote(actor, command as unknown as IssueSupplierDebitNoteCommand)
        case 'debit-note.apply': return gateway.applySupplierDebitNote(actor, command as unknown as ApplySupplierDebitNoteCommand)
        case 'debit-note.void': return gateway.voidSupplierDebitNote(actor, command as unknown as VoidSupplierDebitNoteCommand)
        case 'recurring.create': return gateway.createRecurringSchedule(actor, command as unknown as CreateRecurringScheduleCommand)
        case 'recurring.generate': return gateway.generateRecurringSchedule(actor, command as unknown as GenerateRecurringScheduleCommand)
        case 'recurring.pause': return gateway.pauseRecurringSchedule(actor, command as unknown as PauseRecurringScheduleCommand)
        case 'statement.draft': return gateway.createCounterpartyStatement(actor, command as unknown as CreateCounterpartyStatementCommand)
        case 'documents.bulk-issue': return gateway.bulkIssueDocuments(actor, command as unknown as BulkIssueDocumentsCommand)
        case 'documents.bulk-void': return gateway.bulkVoidDocuments(actor, command as unknown as BulkVoidDocumentsCommand)
        case 'documents.bulk-allocate': return gateway.bulkAllocatePayments(actor, command as unknown as BulkAllocatePaymentsCommand)
        case 'attachment.add': return gateway.addDocumentAttachment(actor, command as unknown as AddDocumentAttachmentCommand)
        case 'payment.observe': return gateway.observePayment(actor, command as unknown as ObservePaymentCommand)
        case 'payment.verify': return gateway.verifyPayment(actor, command as unknown as VerifyPaymentCommand)
        case 'payment.allocate': return gateway.allocatePayment(actor, command as unknown as AllocatePaymentCommand)
        case 'payment.allocation.reverse': return gateway.reverseAllocation(actor, command as unknown as ReverseAllocationCommand)
        case 'bank-account.create': return gateway.createBankAccount(actor, command as unknown as CreateBankAccountCommand)
        case 'bank-transaction.import': return gateway.importBankTransaction(actor, command as unknown as ImportBankTransactionCommand)
        case 'reconciliation.create': return gateway.createReconciliation(actor, command as unknown as CreateReconciliationCommand)
        case 'reconciliation.match': return gateway.addReconciliationMatch(actor, command as unknown as AddReconciliationMatchCommand)
        case 'reconciliation.submit': return gateway.submitReconciliation(actor, command as unknown as SubmitReconciliationCommand)
        case 'reconciliation.approve': return gateway.approveReconciliation(actor, command as unknown as ApproveReconciliationCommand)
      }
    },
  })
})
