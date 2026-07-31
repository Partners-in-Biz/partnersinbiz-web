import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
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
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'role-assignment.bootstrap',
  'approval.create',
  'legal-entity.create',
  'branch.create',
  'book.create',
  'book-policy.create',
  'account.create',
  'period.create',
  'period.close',
  'period.reopen',
  'journal.post',
  'journal.reverse',
] as const

type FoundationOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const repository = new FirestoreFinanceFoundationRepository()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/foundation/commands',
    execute: async (operation, actor, command) => {
      switch (operation as FoundationOperation) {
        case 'role-assignment.bootstrap':
          return repository.bootstrapRoleAssignment(actor, command as {
            id: string
            orgId: string
            legalEntityId: string
            role?: 'finance_admin' | 'finance_approver'
            scopeMode?: 'entity' | 'book'
            bookId?: string
            requestId: string
            idempotencyKey: string
          })
        case 'approval.create':
          return repository.createApproval(actor, command as unknown as CreateFinanceApprovalCommand)
        case 'legal-entity.create':
          return repository.createLegalEntity(actor, command as unknown as CreateLegalEntityCommand)
        case 'branch.create':
          return repository.createBranch(actor, command as unknown as CreateBranchCommand)
        case 'book.create':
          return repository.createBook(actor, command as unknown as CreateBookCommand)
        case 'book-policy.create':
          return repository.createBookPolicyVersion(actor, command as unknown as CreateBookPolicyVersionCommand)
        case 'account.create':
          return repository.createAccount(actor, command as unknown as CreateAccountCommand)
        case 'period.create':
          return repository.createPeriod(actor, command as unknown as CreatePeriodCommand)
        case 'period.close':
          return repository.closePeriod(actor, command as unknown as ChangePeriodStatusCommand)
        case 'period.reopen':
          return repository.reopenPeriod(actor, command as unknown as ChangePeriodStatusCommand)
        case 'journal.post':
          return repository.postJournal(actor, command as unknown as PostJournalCommand)
        case 'journal.reverse':
          return repository.reverseJournal(actor, command as unknown as ReverseJournalCommand)
      }
    },
  })
})
