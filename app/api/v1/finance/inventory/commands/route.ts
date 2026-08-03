import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceInventoryGateway } from '@/lib/accounting/firestore-inventory-gateway'
import type {
  ApplyBillReceiptCommand,
  ApplyInvoiceIssueCommand,
  CreateInventoryItemCommand,
  CreateStockAdjustmentCommand,
  UpdateInventoryItemCommand,
} from '@/lib/accounting/inventory-service'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'item.create',
  'item.update',
  'bill-receipt.apply',
  'invoice-issue.apply',
  'adjustment.create',
] as const

type InventoryOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceInventoryGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/inventory/commands',
    execute: async (operation, actor, command) => {
      switch (operation as InventoryOperation) {
        case 'item.create':
          return gateway.createItem(actor, command as unknown as CreateInventoryItemCommand)
        case 'item.update':
          return gateway.updateItem(actor, command as unknown as UpdateInventoryItemCommand)
        case 'bill-receipt.apply':
          return gateway.applyBillReceipt(actor, command as unknown as ApplyBillReceiptCommand)
        case 'invoice-issue.apply':
          return gateway.applyInvoiceIssue(actor, command as unknown as ApplyInvoiceIssueCommand)
        case 'adjustment.create':
          return gateway.createAdjustment(actor, command as unknown as CreateStockAdjustmentCommand)
      }
    },
  })
})
