import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreStatementFinanceGateway,
  type ApplyStatementCommand,
  type GenerateReconSuggestionsCommand,
  type ParseStatementCommand,
  type ResolveReconSuggestionCommand,
} from '@/lib/finance/statements/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'statement.import.parse',
  'statement.import.apply',
  'recon.suggestion.generate',
  'recon.suggestion.accept',
  'recon.suggestion.dismiss',
] as const

type StatementOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreStatementFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/statements/commands',
    execute: async (operation, actor, command) => {
      switch (operation as StatementOperation) {
        case 'statement.import.parse':
          return gateway.parseStatement(actor, command as unknown as ParseStatementCommand)
        case 'statement.import.apply':
          return gateway.applyStatement(actor, command as unknown as ApplyStatementCommand)
        case 'recon.suggestion.generate':
          return gateway.generateSuggestions(actor, command as unknown as GenerateReconSuggestionsCommand)
        case 'recon.suggestion.accept':
          return gateway.acceptSuggestion(actor, command as unknown as ResolveReconSuggestionCommand)
        case 'recon.suggestion.dismiss':
          return gateway.dismissSuggestion(actor, command as unknown as ResolveReconSuggestionCommand)
      }
    },
  })
})
