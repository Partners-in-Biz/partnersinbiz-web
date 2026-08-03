import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceAssetsGateway } from '@/lib/accounting/firestore-assets-gateway'
import type {
  ActivateFixedAssetCommand,
  CalculateDepreciationRunCommand,
  CreateAssetClassCommand,
  CreateDepreciationRunCommand,
  CreateFixedAssetCommand,
  DisposeFixedAssetCommand,
  PostDepreciationRunCommand,
} from '@/lib/accounting/assets-service'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'asset-class.create',
  'asset.create',
  'asset.activate',
  'depreciation-run.create',
  'depreciation-run.calculate',
  'depreciation-run.post',
  'asset.dispose',
] as const

type AssetsOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceAssetsGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/assets/commands',
    execute: async (operation, actor, command) => {
      switch (operation as AssetsOperation) {
        case 'asset-class.create':
          return gateway.createAssetClass(actor, command as unknown as CreateAssetClassCommand)
        case 'asset.create':
          return gateway.createFixedAsset(actor, command as unknown as CreateFixedAssetCommand)
        case 'asset.activate':
          return gateway.activateFixedAsset(actor, command as unknown as ActivateFixedAssetCommand)
        case 'depreciation-run.create':
          return gateway.createDepreciationRun(actor, command as unknown as CreateDepreciationRunCommand)
        case 'depreciation-run.calculate':
          return gateway.calculateDepreciationRun(actor, command as unknown as CalculateDepreciationRunCommand)
        case 'depreciation-run.post':
          return gateway.postDepreciationRun(actor, command as unknown as PostDepreciationRunCommand)
        case 'asset.dispose':
          return gateway.disposeFixedAsset(actor, command as unknown as DisposeFixedAssetCommand)
      }
    },
  })
})
