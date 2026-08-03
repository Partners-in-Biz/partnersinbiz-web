import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreBankRulesFinanceGateway,
  type EvaluateBankRulesCommand,
  type ResolveBankRuleSuggestionCommand,
  type UpsertBankRuleCommand,
} from '@/lib/finance/bank-rules/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'bank-rule.upsert',
  'bank-rule.evaluate',
  'bank-rule.suggestion.accept',
  'bank-rule.suggestion.dismiss',
] as const

type Op = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreBankRulesFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/bank-rules/commands',
    execute: async (operation, actor, command) => {
      switch (operation as Op) {
        case 'bank-rule.upsert':
          return gateway.upsertRule(actor, command as unknown as UpsertBankRuleCommand)
        case 'bank-rule.evaluate':
          return gateway.evaluate(actor, command as unknown as EvaluateBankRulesCommand)
        case 'bank-rule.suggestion.accept':
          return gateway.acceptSuggestion(actor, command as unknown as ResolveBankRuleSuggestionCommand)
        case 'bank-rule.suggestion.dismiss':
          return gateway.dismissSuggestion(actor, command as unknown as ResolveBankRuleSuggestionCommand)
      }
    },
  })
})
