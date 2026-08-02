import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreCutoverFinanceGateway,
  type ActivateCutoverPackageCommand,
  type ApproveCutoverPackageCommand,
  type CreateCutoverPackageCommand,
  type UpdateCutoverPackageCommand,
  type ValidateCutoverPackageCommand,
} from '@/lib/finance/cutover/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'cutover.package.create',
  'cutover.package.update',
  'cutover.package.validate',
  'cutover.package.approve',
  'cutover.package.activate',
] as const

type CutoverOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreCutoverFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/cutover/commands',
    execute: async (operation, actor, command) => {
      switch (operation as CutoverOperation) {
        case 'cutover.package.create':
          return gateway.createPackage(actor, command as unknown as CreateCutoverPackageCommand)
        case 'cutover.package.update':
          return gateway.updatePackage(actor, command as unknown as UpdateCutoverPackageCommand)
        case 'cutover.package.validate':
          return gateway.validatePackage(actor, command as unknown as ValidateCutoverPackageCommand)
        case 'cutover.package.approve':
          return gateway.approvePackage(actor, command as unknown as ApproveCutoverPackageCommand)
        case 'cutover.package.activate':
          return gateway.activatePackage(actor, command as unknown as ActivateCutoverPackageCommand)
      }
    },
  })
})
