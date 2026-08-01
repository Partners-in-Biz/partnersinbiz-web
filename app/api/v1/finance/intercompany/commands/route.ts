import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreFinanceIntercompanyGateway,
  type ActivateIntercompanyPairCommand,
  type ApproveConsolidationRunCommand,
  type ApproveEliminationRuleCommand,
  type ApproveIntercompanyReceiveCommand,
  type CreateConsolidationRunCommand,
  type CreateEliminationRuleCommand,
  type CreateIntercompanyPairCommand,
  type PinConsolidationRunCommand,
  type PostConsolidationEliminationsCommand,
  type PostIntercompanyReceivingCommand,
  type PostIntercompanySourceCommand,
  type ProposeIntercompanyTransactionCommand,
  type RejectIntercompanyTransactionCommand,
} from '@/lib/accounting/firestore-intercompany-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'pair.create',
  'pair.activate',
  'transaction.propose',
  'transaction.post-source',
  'transaction.approve-receive',
  'transaction.post-receiving',
  'transaction.reject',
  'elimination-rule.create',
  'elimination-rule.approve',
  'consolidation.create',
  'consolidation.pin',
  'consolidation.post-eliminations',
  'consolidation.approve',
] as const

type IcOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceIntercompanyGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/intercompany/commands',
    execute: async (operation, actor, command) => {
      switch (operation as IcOperation) {
        case 'pair.create':
          return gateway.createPair(actor, command as unknown as CreateIntercompanyPairCommand)
        case 'pair.activate':
          return gateway.activatePair(actor, command as unknown as ActivateIntercompanyPairCommand)
        case 'transaction.propose':
          return gateway.proposeTransaction(actor, command as unknown as ProposeIntercompanyTransactionCommand)
        case 'transaction.post-source':
          return gateway.postSource(actor, command as unknown as PostIntercompanySourceCommand)
        case 'transaction.approve-receive':
          return gateway.approveReceive(actor, command as unknown as ApproveIntercompanyReceiveCommand)
        case 'transaction.post-receiving':
          return gateway.postReceiving(actor, command as unknown as PostIntercompanyReceivingCommand)
        case 'transaction.reject':
          return gateway.rejectTransaction(actor, command as unknown as RejectIntercompanyTransactionCommand)
        case 'elimination-rule.create':
          return gateway.createEliminationRule(actor, command as unknown as CreateEliminationRuleCommand)
        case 'elimination-rule.approve':
          return gateway.approveEliminationRule(actor, command as unknown as ApproveEliminationRuleCommand)
        case 'consolidation.create':
          return gateway.createConsolidationRun(actor, command as unknown as CreateConsolidationRunCommand)
        case 'consolidation.pin':
          return gateway.pinConsolidationRun(actor, command as unknown as PinConsolidationRunCommand)
        case 'consolidation.post-eliminations':
          return gateway.postEliminations(actor, command as unknown as PostConsolidationEliminationsCommand)
        case 'consolidation.approve':
          return gateway.approveConsolidationRun(actor, command as unknown as ApproveConsolidationRunCommand)
      }
    },
  })
})
