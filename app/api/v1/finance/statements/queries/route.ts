import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreStatementFinanceGateway } from '@/lib/finance/statements/firestore-gateway'
import { StatementFinanceValidationError } from '@/lib/finance/statements/service'
import { parsePositiveInt, STATEMENT_LINES_UI_DEFAULT } from '@/lib/finance/scale/pagination'
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
      const lineLimit = parsePositiveInt(params.get('lineLimit'), STATEMENT_LINES_UI_DEFAULT)
      const lineOffset = parsePositiveInt(params.get('lineOffset'), 0)
      const suggestionLimit = parsePositiveInt(params.get('suggestionLimit'), STATEMENT_LINES_UI_DEFAULT)
      const suggestionOffset = parsePositiveInt(params.get('suggestionOffset'), 0)
      const batchLimit = parsePositiveInt(params.get('batchLimit'), 50)
      const batchOffset = parsePositiveInt(params.get('batchOffset'), 0)
      return gateway.listForOrg(actor, orgId, {
        bankAccountId,
        batchId,
        lineLimit,
        lineOffset,
        suggestionLimit,
        suggestionOffset,
        batchLimit,
        batchOffset,
      })
    },
  })
})
