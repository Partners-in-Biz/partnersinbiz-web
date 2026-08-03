import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinancePayrollGateway } from '@/lib/payroll/firestore-payroll-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = [
  'bundle','payslip','my-payslips','ess-bundle','payslip-pack','bulk-payslip-pack',
  'pay-run-board','leave-month','salary-structures','vera-fixtures','vera-fixture',
  'irp5','emp201','emp501','export-manifest',
] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinancePayrollGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/payroll/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
      const scope = { orgId, legalEntityId, bookId }
      switch (resource) {
        case 'bundle': return gateway.listBundle(actor, scope)
        case 'payslip': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for payslip')
          return gateway.getPayslip(actor, scope, id)
        }
        case 'my-payslips': return gateway.listMyPayslips(actor, scope)
        case 'ess-bundle': return gateway.listEssBundle(actor, scope)
        case 'payslip-pack': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for payslip-pack')
          return gateway.getPayslipPack(actor, scope, id)
        }
        case 'bulk-payslip-pack': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for bulk-payslip-pack')
          return gateway.getBulkPayslipRunPack(actor, scope, id)
        }
        case 'pay-run-board': {
          return gateway.getPayRunBoard(actor, scope, {
            windowStart: params.get('windowStart') || undefined,
            windowEnd: params.get('windowEnd') || undefined,
          })
        }
        case 'leave-month': {
          const year = Number(params.get('year'))
          const month = Number(params.get('month'))
          if (!Number.isInteger(year) || !Number.isInteger(month)) {
            throw new FinanceValidationError('year and month are required for leave-month')
          }
          return gateway.getLeaveMonth(actor, scope, year, month)
        }
        case 'salary-structures': return gateway.listSalaryStructures(actor, scope)
        case 'vera-fixtures': return gateway.listVeraFixtures(actor, scope)
        case 'vera-fixture': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for vera-fixture')
          return gateway.runVeraFixture(actor, scope, id)
        }
        case 'irp5': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for irp5')
          return gateway.getIrp5(actor, scope, id)
        }
        case 'emp201': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for emp201')
          return gateway.getEmp201(actor, scope, id)
        }
        case 'emp501': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for emp501')
          return gateway.getEmp501(actor, scope, id)
        }
        case 'export-manifest': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for export-manifest')
          return gateway.getExportManifest(actor, scope, id)
        }
        default: throw new FinanceValidationError('Unsupported payroll query resource')
      }
    },
  })
})
