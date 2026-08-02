import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestorePackagingFinanceGateway,
  type ArchivePackCommand,
  type CreatePackagingPackCommand,
  type MarkDownloadedPackCommand,
} from '@/lib/finance/packaging/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'packaging.pack.create',
  'packaging.pack.mark_downloaded',
  'packaging.pack.archive',
] as const

type PackagingOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestorePackagingFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/packaging/commands',
    execute: async (operation, actor, command) => {
      switch (operation as PackagingOperation) {
        case 'packaging.pack.create':
          return gateway.createPack(actor, command as unknown as CreatePackagingPackCommand)
        case 'packaging.pack.mark_downloaded':
          return gateway.markDownloaded(actor, command as unknown as MarkDownloadedPackCommand)
        case 'packaging.pack.archive':
          return gateway.archivePack(actor, command as unknown as ArchivePackCommand)
      }
    },
  })
})
