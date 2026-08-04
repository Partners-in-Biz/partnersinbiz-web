import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceRevenueRecognitionGateway } from '@/lib/accounting/firestore-revenue-recognition-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'schedule', 'recognition-run', 'deferred-revenue', 'recognized-vs-billed'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceRevenueRecognitionGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/revenue-recognition/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
      const scope = { orgId, legalEntityId, bookId }
      if (resource === 'bundle') return gateway.listBundle(actor, scope)
      if (resource === 'schedule') {
        const scheduleId = params.get('scheduleId')
        if (!scheduleId) throw new FinanceValidationError('scheduleId is required')
        return gateway.getSchedule(actor, scope, scheduleId)
      }
      if (resource === 'recognition-run') {
        const runId = params.get('runId')
        if (!runId) throw new FinanceValidationError('runId is required')
        return gateway.getRecognitionRun(actor, scope, runId)
      }
      const asOfPeriodKey = params.get('asOfPeriodKey') || new Date().toISOString().slice(0, 7)
      if (resource === 'deferred-revenue') return gateway.deferredRevenueReport(actor, scope, asOfPeriodKey)
      if (resource === 'recognized-vs-billed') return gateway.recognizedVsBilledReport(actor, scope, asOfPeriodKey)
      throw new FinanceValidationError('Unsupported revenue recognition query resource')
    },
  })
})
