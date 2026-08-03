import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreBankFeedFinanceGateway } from '@/lib/finance/bank-feeds/firestore-gateway'
import { BankFeedValidationError } from '@/lib/finance/bank-feeds/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'provider-accounts', 'recon-centre'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreBankFeedFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/bank-feeds/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId') || ''
      const bookId = params.get('bookId') || ''
      if (!legalEntityId || !bookId) throw new BankFeedValidationError('legalEntityId and bookId are required')

      if (resource === 'bundle') {
        return gateway.getBundle(actor, orgId, legalEntityId, bookId)
      }

      if (resource === 'recon-centre') {
        return gateway.getReconCentre(actor, orgId, legalEntityId, bookId)
      }

      if (resource === 'provider-accounts') {
        const connectionId = params.get('connectionId') || ''
        if (!connectionId) throw new BankFeedValidationError('connectionId is required')
        return gateway.listProviderAccounts(actor, {
          orgId,
          legalEntityId,
          bookId,
          connectionId,
        })
      }

      throw new BankFeedValidationError('Unsupported bank-feeds query resource')
    },
  })
})
