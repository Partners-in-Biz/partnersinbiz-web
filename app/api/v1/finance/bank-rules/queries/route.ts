import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreBankRulesFinanceGateway } from '@/lib/finance/bank-rules/firestore-gateway'
import { BankRulesValidationError } from '@/lib/finance/bank-rules/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreBankRulesFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/bank-rules/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') throw new BankRulesValidationError('Unsupported bank-rules query resource')
      const legalEntityId = params.get('legalEntityId') || ''
      const bookId = params.get('bookId') || ''
      if (!legalEntityId || !bookId) throw new BankRulesValidationError('legalEntityId and bookId are required')
      return gateway.getBundle(actor, orgId, legalEntityId, bookId)
    },
  })
})
