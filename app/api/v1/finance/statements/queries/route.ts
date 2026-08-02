import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreStatementFinanceGateway } from '@/lib/finance/statements/firestore-gateway'
import { StatementFinanceValidationError } from '@/lib/finance/statements/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreStatementFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/statements/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') {
        throw new StatementFinanceValidationError('Unsupported statement finance query resource')
      }
      const bankAccountId = params.get('bankAccountId') || undefined
      const batchId = params.get('batchId') || undefined
      return gateway.listForOrg(actor, orgId, { bankAccountId, batchId })
    },
  })
})
