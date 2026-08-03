import {
  FinanceProvingService,
  cloneProvingStore,
  createEmptyProvingStore,
  type PackagingDryRunCommand,
  type ProvingStore,
  type RunCloseFixtureCommand,
  type SeedProvingCommand,
  type ToggleChecklistCommand,
} from './service'
import type { FinanceActorContext } from '@/lib/finance/types'

export type {
  PackagingDryRunCommand,
  RunCloseFixtureCommand,
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

  packagingDryRun(actor: FinanceActorContext, command: PackagingDryRunCommand) {
    return this.service().packagingDryRun(actor, command)
  }

  toggleChecklist(actor: FinanceActorContext, command: ToggleChecklistCommand) {
    return this.service().toggleChecklist(actor, command)
  }
}
