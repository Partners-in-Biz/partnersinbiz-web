import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreBankFeedFinanceGateway,
  type CreateBankFeedConnectionCommand,
  type DisconnectBankFeedCommand,
  type ResolveBankFeedSuggestionCommand,
  type SyncBankFeedCommand,
} from '@/lib/finance/bank-feeds/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'bank-feed.connection.create',
  'bank-feed.connection.disconnect',
  'bank-feed.sync',
  'bank-feed.suggestion.accept',
  'bank-feed.suggestion.dismiss',
] as const

type Op = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreBankFeedFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/bank-feeds/commands',
    execute: async (operation, actor, command) => {
      switch (operation as Op) {
        case 'bank-feed.connection.create':
          return gateway.createConnection(actor, command as unknown as CreateBankFeedConnectionCommand)
        case 'bank-feed.connection.disconnect':
          return gateway.disconnectConnection(actor, command as unknown as DisconnectBankFeedCommand)
        case 'bank-feed.sync':
          return gateway.syncNow(actor, command as unknown as SyncBankFeedCommand)
        case 'bank-feed.suggestion.accept':
          return gateway.acceptSuggestion(actor, command as unknown as ResolveBankFeedSuggestionCommand)
        case 'bank-feed.suggestion.dismiss':
          return gateway.dismissSuggestion(actor, command as unknown as ResolveBankFeedSuggestionCommand)
      }
    },
  })
})
