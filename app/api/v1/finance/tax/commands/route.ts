import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreFinanceTaxGateway,
  type ApproveTaxReturnCommand,
  type CalculateTaxCommand,
  type ChangeTaxPeriodStatusCommand,
  type CreateTaxCodeCommand,
  type CreateTaxPeriodCommand,
  type CreateTaxRuleVersionCommand,
  type PrepareTaxReturnCommand,
} from '@/lib/accounting/firestore-tax-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'tax-code.create',
  'tax-rule.create',
  'tax-period.create',
  'tax-period.status',
  'tax-return.prepare',
  'tax-return.approve',
  'tax.calculate',
] as const

type TaxOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceTaxGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/tax/commands',
    execute: async (operation, actor, command) => {
      switch (operation as TaxOperation) {
        case 'tax-code.create':
          return gateway.createTaxCode(actor, command as unknown as CreateTaxCodeCommand)
        case 'tax-rule.create':
          return gateway.createTaxRuleVersion(actor, command as unknown as CreateTaxRuleVersionCommand)
        case 'tax-period.create':
          return gateway.createTaxPeriod(actor, command as unknown as CreateTaxPeriodCommand)
        case 'tax-period.status':
          return gateway.changeTaxPeriodStatus(actor, command as unknown as ChangeTaxPeriodStatusCommand)
        case 'tax-return.prepare':
          return gateway.prepareTaxReturn(actor, command as unknown as PrepareTaxReturnCommand)
        case 'tax-return.approve':
          return gateway.approveTaxReturn(actor, command as unknown as ApproveTaxReturnCommand)
        case 'tax.calculate':
          return gateway.calculateTax(actor, command as unknown as CalculateTaxCommand)
      }
    },
  })
})
