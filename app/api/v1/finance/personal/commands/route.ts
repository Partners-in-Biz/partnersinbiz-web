import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestorePersonalFinanceGateway,
  type CreatePersonalAccountCommand,
  type CreatePersonalBookCommand,
  type PostPersonalEntryCommand,
  type ProposePersonalTransferCommand,
  type RejectPersonalTransferCommand,
  type ResolvePersonalTransferCommand,
} from '@/lib/finance/personal/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'personal.book.create',
  'personal.account.create',
  'personal.entry.post',
  'personal.transfer.propose',
  'personal.transfer.accept',
  'personal.transfer.reject',
] as const

type PersonalOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestorePersonalFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/personal/commands',
    execute: async (operation, actor, command) => {
      switch (operation as PersonalOperation) {
        case 'personal.book.create':
          return gateway.createBook(actor, command as unknown as CreatePersonalBookCommand)
        case 'personal.account.create':
          return gateway.createAccount(actor, command as unknown as CreatePersonalAccountCommand)
        case 'personal.entry.post':
          return gateway.postEntry(actor, command as unknown as PostPersonalEntryCommand)
        case 'personal.transfer.propose':
          return gateway.proposeTransfer(actor, command as unknown as ProposePersonalTransferCommand)
        case 'personal.transfer.accept':
          return gateway.acceptTransfer(actor, command as unknown as ResolvePersonalTransferCommand)
        case 'personal.transfer.reject':
          return gateway.rejectTransfer(actor, command as unknown as RejectPersonalTransferCommand)
      }
    },
  })
})
