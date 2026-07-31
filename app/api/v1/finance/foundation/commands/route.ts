import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { loadFinanceActorContext } from '@/lib/finance/firestore-context'
import { mapFinanceErrorToHttp } from '@/lib/finance/errors'
import { checkFinanceCommandOrgScope } from '@/lib/finance/http-guards'
import { FirestoreFinanceFoundationRepository } from '@/lib/accounting/firestore-foundation-repository'
import type {
  ChangePeriodStatusCommand,
  CreateAccountCommand,
  CreateBookCommand,
  CreateBookPolicyVersionCommand,
  CreateBranchCommand,
  CreateFinanceApprovalCommand,
  CreateLegalEntityCommand,
  CreatePeriodCommand,
  PostJournalCommand,
  ReverseJournalCommand,
} from '@/lib/accounting/foundation-service'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'approval.create', 'legal-entity.create', 'branch.create', 'book.create', 'book-policy.create',
  'account.create', 'period.create', 'period.close', 'period.reopen', 'journal.post', 'journal.reverse',
] as const

type FoundationOperation = typeof OPERATIONS[number]
type FoundationCommand = CreateFinanceApprovalCommand | CreateLegalEntityCommand | CreateBranchCommand |
  CreateBookCommand | CreateBookPolicyVersionCommand | CreateAccountCommand | CreatePeriodCommand |
  ChangePeriodStatusCommand | PostJournalCommand | ReverseJournalCommand

async function execute(
  repository: FirestoreFinanceFoundationRepository,
  operation: FoundationOperation,
  actor: Awaited<ReturnType<typeof loadFinanceActorContext>>,
  command: FoundationCommand,
): Promise<unknown> {
  switch (operation) {
    case 'approval.create': return repository.createApproval(actor, command as CreateFinanceApprovalCommand)
    case 'legal-entity.create': return repository.createLegalEntity(actor, command as CreateLegalEntityCommand)
    case 'branch.create': return repository.createBranch(actor, command as CreateBranchCommand)
    case 'book.create': return repository.createBook(actor, command as CreateBookCommand)
    case 'book-policy.create': return repository.createBookPolicyVersion(actor, command as CreateBookPolicyVersionCommand)
    case 'account.create': return repository.createAccount(actor, command as CreateAccountCommand)
    case 'period.create': return repository.createPeriod(actor, command as CreatePeriodCommand)
    case 'period.close': return repository.closePeriod(actor, command as ChangePeriodStatusCommand)
    case 'period.reopen': return repository.reopenPeriod(actor, command as ChangePeriodStatusCommand)
    case 'journal.post': return repository.postJournal(actor, command as PostJournalCommand)
    case 'journal.reverse': return repository.reverseJournal(actor, command as ReverseJournalCommand)
  }
}

export const POST = withAuth('client', async (req: NextRequest, user) => {
  try {
    const body = await req.json() as { operation?: unknown; command?: unknown }
    if (typeof body.operation !== 'string' || !OPERATIONS.includes(body.operation as FoundationOperation)) {
      return apiError('Unsupported finance foundation operation', 422)
    }
    const commandOrgId = body.command && typeof body.command === 'object'
      ? (body.command as Record<string, unknown>).orgId
      : undefined
    const orgCheck = checkFinanceCommandOrgScope(commandOrgId, req.headers.get('x-org-id'))
    if (!orgCheck.ok) return apiError(orgCheck.error, orgCheck.status)
    const orgId = orgCheck.orgId

    const actor = await loadFinanceActorContext(user, orgId, {
      correlationId: req.headers.get('x-correlation-id') ?? undefined,
    })
    const result = await execute(new FirestoreFinanceFoundationRepository(), body.operation as FoundationOperation,
      actor, body.command as FoundationCommand)
    return apiSuccess({ operation: body.operation, result })
  } catch (error) {
    if (error instanceof SyntaxError) return apiError('Invalid JSON body', 400)
    const mapped = mapFinanceErrorToHttp(error)
    if (mapped.code === 'finance_internal') {
      console.error('[finance/foundation/commands] failed', error)
    }
    return apiError(mapped.error, mapped.status, { code: mapped.code })
  }
})
