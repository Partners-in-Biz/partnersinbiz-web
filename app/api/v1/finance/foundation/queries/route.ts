import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceFoundationRepository } from '@/lib/accounting/firestore-foundation-repository'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'
import { FinanceValidationError } from '@/lib/accounting/foundation'

export const dynamic = 'force-dynamic'

const RESOURCES = [
  'assignments.me',
  'legal-entities',
  'books',
  'periods',
  'accounts',
  'journals',
] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const repository = new FirestoreFinanceFoundationRepository()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/foundation/queries',
    execute: async (resource, actor, params, orgId) => {
      switch (resource) {
        case 'assignments.me':
          return repository.listMyAssignments(actor, orgId)
        case 'legal-entities':
          return repository.listLegalEntities(actor, orgId)
        case 'books': {
          const legalEntityId = params.get('legalEntityId')
          if (!legalEntityId) throw new FinanceValidationError('legalEntityId is required')
          return repository.listBooks(actor, orgId, legalEntityId)
        }
        case 'periods': {
          const legalEntityId = params.get('legalEntityId')
          const bookId = params.get('bookId')
          if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
          return repository.listPeriods(actor, orgId, legalEntityId, bookId)
        }
        case 'accounts': {
          const legalEntityId = params.get('legalEntityId')
          const bookId = params.get('bookId')
          if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
          return repository.listAccounts(actor, orgId, legalEntityId, bookId)
        }
        case 'journals': {
          const legalEntityId = params.get('legalEntityId')
          const bookId = params.get('bookId')
          if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
          const limit = Number(params.get('limit') ?? '50')
          return repository.listJournals(actor, orgId, legalEntityId, bookId, Number.isFinite(limit) ? limit : 50)
        }
        default:
          throw new FinanceValidationError('Unsupported finance query resource')
      }
    },
  })
})
