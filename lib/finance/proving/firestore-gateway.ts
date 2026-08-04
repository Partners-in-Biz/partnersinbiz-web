import {
  FinanceProvingService,
  cloneProvingStore,
  createEmptyProvingStore,
  type ExportAcceptancePackCommand,
  type PackagingDryRunCommand,
  type ResetProvingCommand,
  type RunCloseFixtureCommand,
  type RunMultiMonthCloseCommand,
  type ProvingStore,
  type SeedProvingCommand,
  type ToggleChecklistCommand,
} from './service'
import type { FinanceActorContext } from '@/lib/finance/types'

export type {
  ExportAcceptancePackCommand,
  PackagingDryRunCommand,
  ResetProvingCommand,
  RunCloseFixtureCommand,
  RunMultiMonthCloseCommand,
  SeedProvingCommand,
  ToggleChecklistCommand,
} from './service'

/** Process-local proving workspace store (dev/staging fixture). Not a permanent CEO dashboard. */
let processStore: ProvingStore = createEmptyProvingStore()

export function resetProvingProcessStoreForTests() {
  processStore = createEmptyProvingStore()
}

export class ProvingFinanceGateway {
  private service() {
    return new FinanceProvingService(
      async () => processStore,
      async (_before, after) => {
        processStore = cloneProvingStore(after)
      },
    )
  }

  getBundle(actor: FinanceActorContext, orgId: string) {
    return this.service().getBundle(actor, orgId)
  }

  seedDemoCompany(actor: FinanceActorContext, command: SeedProvingCommand) {
    return this.service().seedDemoCompany(actor, command)
  }

  runCloseFixture(actor: FinanceActorContext, command: RunCloseFixtureCommand) {
    return this.service().runCloseFixture(actor, command)
  }

  runMultiMonthCloseProgram(actor: FinanceActorContext, command: RunMultiMonthCloseCommand) {
    return this.service().runMultiMonthCloseProgram(actor, command)
  }

  packagingDryRun(actor: FinanceActorContext, command: PackagingDryRunCommand) {
    return this.service().packagingDryRun(actor, command)
  }

  toggleChecklist(actor: FinanceActorContext, command: ToggleChecklistCommand) {
    return this.service().toggleChecklist(actor, command)
  }

  resetDemoCompany(actor: FinanceActorContext, command: ResetProvingCommand) {
    return this.service().resetDemoCompany(actor, command)
  }

  exportAcceptancePack(actor: FinanceActorContext, command: ExportAcceptancePackCommand) {
    return this.service().exportAcceptancePack(actor, command)
  }
}
