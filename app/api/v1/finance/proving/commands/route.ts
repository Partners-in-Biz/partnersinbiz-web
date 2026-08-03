import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  ProvingFinanceGateway,
  type ExportAcceptancePackCommand,
  type PackagingDryRunCommand,
  type ResetProvingCommand,
  type RunCloseFixtureCommand,
  type RunMultiMonthCloseCommand,
  type SeedProvingCommand,
  type ToggleChecklistCommand,
} from '@/lib/finance/proving/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'proving.seed',
  'proving.close_fixture.run',
  'proving.multi_month_close.run',
  'proving.packaging.dry_run',
  'proving.checklist.toggle',
  'proving.reset',
  'proving.acceptance_pack.export',
] as const

type ProvingOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new ProvingFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/proving/commands',
    execute: async (operation, actor, command) => {
      switch (operation as ProvingOperation) {
        case 'proving.seed':
          return gateway.seedDemoCompany(actor, command as unknown as SeedProvingCommand)
        case 'proving.close_fixture.run':
          return gateway.runCloseFixture(actor, command as unknown as RunCloseFixtureCommand)
        case 'proving.multi_month_close.run':
          return gateway.runMultiMonthCloseProgram(actor, command as unknown as RunMultiMonthCloseCommand)
        case 'proving.packaging.dry_run':
          return gateway.packagingDryRun(actor, command as unknown as PackagingDryRunCommand)
        case 'proving.checklist.toggle':
          return gateway.toggleChecklist(actor, command as unknown as ToggleChecklistCommand)
        case 'proving.reset':
          return gateway.resetDemoCompany(actor, command as unknown as ResetProvingCommand)
        case 'proving.acceptance_pack.export':
          return gateway.exportAcceptancePack(actor, command as unknown as ExportAcceptancePackCommand)
      }
    },
  })
})
