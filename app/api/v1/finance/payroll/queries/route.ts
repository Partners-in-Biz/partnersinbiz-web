import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinancePayrollGateway } from '@/lib/payroll/firestore-payroll-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'payslip', 'irp5', 'emp201', 'emp501', 'export-manifest'] as const

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
        case 'bundle':
          return gateway.listBundle(actor, scope)
        case 'payslip': {
          const id = params.get('id')
          if (!id) throw new FinanceValidationError('id is required for payslip')
          return gateway.getPayslip(actor, scope, id)
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
        default:
          throw new FinanceValidationError('Unsupported payroll query resource')
      }
    },
  })
})
