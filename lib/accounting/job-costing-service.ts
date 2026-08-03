import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { AccountingBasis, FinanceActorContext } from '@/lib/finance/types'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import {
  FinanceValidationError,
  assertCreateVersion,
  assertEnumValue,
  parseCanonicalDate,
  requiredText,
} from './foundation'
import {
  buildDraftInvoiceLinesFromTime,
  buildProjectProfitAndLoss,
  buildProjectWip,
  buildTimeCostLines,
  buildWipJournalLines,
  timeEntryClaimKey,
} from './job-costing'
import type {
  JobCostingAuditEvent,
  JobCostingScope,
  ProjectProfitAndLossReport,
  ProjectWipReport,
  TimeCostApplication,
  TimeCostPurpose,
  TimeCostSourceEntry,
} from './job-costing-types'
import type { FinanceCustomerInvoice, SupplierBill } from './documents-types'
import type { LedgerAccount, PostedJournalEntry } from './types'

export interface JobCostingStore {
  applications: Map<string, TimeCostApplication>
  claims: Set<string>
  auditEvents: JobCostingAuditEvent[]
  accounts: Map<string, LedgerAccount>
  journals: Map<string, PostedJournalEntry>
  invoices: Map<string, FinanceCustomerInvoice>
  bills: Map<string, SupplierBill>
  idempotency: Map<string, { payloadDigest: string; applicationId: string; actorId: string }>
}

export function createEmptyJobCostingStore(): JobCostingStore {
  return {
    applications: new Map(),
    claims: new Set(),
    auditEvents: [],
    accounts: new Map(),
    journals: new Map(),
    invoices: new Map(),
    bills: new Map(),
    idempotency: new Map(),
  }
}

export function cloneJobCostingStore(store: JobCostingStore): JobCostingStore {
  return {
    applications: new Map(store.applications),
    claims: new Set(store.claims),
    auditEvents: [...store.auditEvents],
    accounts: new Map(store.accounts),
    journals: new Map(store.journals),
    invoices: new Map(store.invoices),
    bills: new Map(store.bills),
    idempotency: new Map(store.idempotency),
  }
}

export interface ApplyTimeCostCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  purpose: TimeCostPurpose
  currency: string
  entries: TimeCostSourceEntry[]
  laborExpenseAccountId?: string
  wipAssetAccountId?: string
  revenueAccountId?: string
  taxCodeId?: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

function claim(store: JobCostingStore, key: string, message: string) {
  if (store.claims.has(key)) throw new FinanceValidationError(message)
  store.claims.add(key)
}

function appendAudit(
  store: JobCostingStore,
  actor: FinanceActorContext,
  scope: JobCostingScope,
  application: TimeCostApplication,
  now: string,
  eventType: JobCostingAuditEvent['eventType'],
) {
  const previous = [...store.auditEvents].reverse().find(
    (e) => e.orgId === scope.orgId && e.legalEntityId === scope.legalEntityId && e.bookId === scope.bookId,
  )
  const sequence = (previous?.sequence ?? 0) + 1
  const base = {
    ...scope,
    id: `jcaud_${scope.orgId}_${sequence}`,
    schemaVersion: 1 as const,
    aggregateType: 'time_cost_application' as const,
    aggregateId: application.id,
    aggregateVersion: application.version,
    eventType,
    actorId: actor.uid,
    requestId: application.requestId,
    idempotencyKey: application.idempotencyKey,
    occurredAt: now,
    sequence,
    ...(previous ? { previousEventId: previous.id, previousEventHash: previous.eventHash } : {}),
    payload: {
      purpose: application.purpose,
      totalCostMinor: application.totalCostMinor,
      timeEntryIds: application.timeEntryIds,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
    },
    externalEgressAllowed: false as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  store.auditEvents.push({ ...base, eventHash: canonicalDigest(base) })
}

export class FinanceJobCostingService {
  constructor(
    private readonly load: () => Promise<JobCostingStore>,
    private readonly save: (before: JobCostingStore, after: JobCostingStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async mutate<T>(fn: (store: JobCostingStore) => T): Promise<T> {
    const before = await this.load()
    const after = cloneJobCostingStore(before)
    const result = fn(after)
    await this.save(before, after)
    return result
  }

  async applyTimeCost(actor: FinanceActorContext, command: ApplyTimeCostCommand): Promise<TimeCostApplication> {
    return this.mutate((store) => {
      const scope: JobCostingScope = {
        orgId: requiredText(command.orgId, 'orgId'),
        legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
        bookId: requiredText(command.bookId, 'bookId'),
      }
      authorizeFinanceAction(actor, scope, 'job_costing.time_cost.apply', this.now())
      assertCreateVersion(command.expectedVersion, 'Time cost application')
      assertEnumValue(command.purpose, ['wip_cost', 'draft_invoice_lines'], 'purpose')
      requiredText(command.requestId, 'requestId')
      requiredText(command.idempotencyKey, 'idempotencyKey')
      const currency = requiredText(command.currency, 'currency').toUpperCase()

      const idemKey = `${scope.orgId}:${actor.uid}:${command.idempotencyKey}`
      const existingIdem = store.idempotency.get(idemKey)
      if (existingIdem) {
        const payloadDigest = canonicalDigest(command)
        if (existingIdem.payloadDigest !== payloadDigest || existingIdem.actorId !== actor.uid) {
          throw new FinanceValidationError('Idempotency key payload mismatch')
        }
        const prior = store.applications.get(existingIdem.applicationId)
        if (!prior) throw new FinanceValidationError('Idempotency result is missing')
        return prior
      }

      if (store.applications.has(command.id)) {
        throw new FinanceValidationError('Time cost application id already exists')
      }

      const lines = buildTimeCostLines(command.entries, command.purpose, scope.orgId)
      for (const line of lines) {
        if (line.currency !== currency) {
          throw new FinanceValidationError(`Time entry ${line.timeEntryId} currency mismatch`)
        }
        claim(
          store,
          timeEntryClaimKey(command.purpose, line.timeEntryId),
          `Time entry ${line.timeEntryId} already has a ${command.purpose} application — refusing double-billing/double-costing`,
        )
      }

      let proposedJournalLines = undefined as TimeCostApplication['proposedJournalLines']
      let proposedInvoiceLines = undefined as TimeCostApplication['proposedInvoiceLines']
      if (command.purpose === 'wip_cost') {
        proposedJournalLines = buildWipJournalLines({
          lines,
          laborExpenseAccountId: requiredText(command.laborExpenseAccountId || '', 'laborExpenseAccountId'),
          wipAssetAccountId: requiredText(command.wipAssetAccountId || '', 'wipAssetAccountId'),
        })
      } else {
        proposedInvoiceLines = buildDraftInvoiceLinesFromTime({
          lines,
          revenueAccountId: requiredText(command.revenueAccountId || '', 'revenueAccountId'),
          taxCodeId: requiredText(command.taxCodeId || '', 'taxCodeId'),
        })
      }

      const now = this.now()
      const projectIds = [...new Set(lines.map((l) => l.projectId))].sort()
      const timeEntryIds = lines.map((l) => l.timeEntryId).sort()
      const totalCostMinor = lines.reduce((s, l) => s + l.amountMinor, 0)
      const base = {
        ...scope,
        id: requiredText(command.id, 'id'),
        purpose: command.purpose,
        status: 'applied' as const,
        currency,
        projectIds,
        timeEntryIds,
        lines,
        totalCostMinor,
        ...(proposedJournalLines ? { proposedJournalLines } : {}),
        ...(proposedInvoiceLines ? { proposedInvoiceLines } : {}),
        ...(command.laborExpenseAccountId
          ? { laborExpenseAccountId: command.laborExpenseAccountId }
          : {}),
        ...(command.wipAssetAccountId ? { wipAssetAccountId: command.wipAssetAccountId } : {}),
        ...(command.revenueAccountId ? { revenueAccountId: command.revenueAccountId } : {}),
        ...(command.taxCodeId ? { taxCodeId: command.taxCodeId } : {}),
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        immutable: true as const,
        externalEgressAllowed: false as const,
        externalPaymentInitiated: false as const,
        canonicalPayloadVersion: 1 as const,
        hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
        schemaVersion: 1 as const,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      const application: TimeCostApplication = {
        ...base,
        contentHash: canonicalDigest(base),
      }
      store.applications.set(application.id, application)
      store.idempotency.set(idemKey, {
        payloadDigest: canonicalDigest(command),
        applicationId: application.id,
        actorId: actor.uid,
      })
      appendAudit(store, actor, scope, application, now, 'job_costing.time_cost.applied')
      return application
    })
  }

  projectProfitAndLoss(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      projectId: string
      fromDate: string
      toDate: string
      accountingBasis: AccountingBasis
    },
    storeOverride?: JobCostingStore,
  ): Promise<ProjectProfitAndLossReport> {
    const run = (store: JobCostingStore) => {
      const scope: JobCostingScope = {
        orgId: input.orgId,
        legalEntityId: input.legalEntityId,
        bookId: input.bookId,
      }
      authorizeFinanceAction(actor, scope, 'job_costing.read', this.now())
      assertEnumValue(input.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
      return buildProjectProfitAndLoss({
        scope,
        projectId: input.projectId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        accountingBasis: input.accountingBasis,
        accounts: [...store.accounts.values()].filter(
          (a) => a.orgId === scope.orgId && a.legalEntityId === scope.legalEntityId && a.bookId === scope.bookId,
        ),
        journals: [...store.journals.values()].filter(
          (j) => j.orgId === scope.orgId && j.legalEntityId === scope.legalEntityId && j.bookId === scope.bookId,
        ),
        invoices: [...store.invoices.values()].filter(
          (i) => i.orgId === scope.orgId && i.legalEntityId === scope.legalEntityId && i.bookId === scope.bookId,
        ),
        bills: [...store.bills.values()].filter(
          (b) => b.orgId === scope.orgId && b.legalEntityId === scope.legalEntityId && b.bookId === scope.bookId,
        ),
      })
    }
    if (storeOverride) return Promise.resolve(run(storeOverride))
    return this.load().then(run)
  }

  async projectWip(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      projectId: string
      asOfDate: string
      accountingBasis: AccountingBasis
      fromDate?: string
    },
  ): Promise<ProjectWipReport> {
    const store = await this.load()
    const scope: JobCostingScope = {
      orgId: input.orgId,
      legalEntityId: input.legalEntityId,
      bookId: input.bookId,
    }
    authorizeFinanceAction(actor, scope, 'job_costing.read', this.now())
    parseCanonicalDate(input.asOfDate, 'asOfDate')
    const fromDate = input.fromDate ?? '1970-01-01'
    const pnl = await this.projectProfitAndLoss(
      actor,
      {
        orgId: input.orgId,
        legalEntityId: input.legalEntityId,
        bookId: input.bookId,
        projectId: input.projectId,
        fromDate,
        toDate: input.asOfDate,
        accountingBasis: input.accountingBasis,
      },
      store,
    )
    return buildProjectWip({
      scope,
      projectId: input.projectId,
      asOfDate: input.asOfDate,
      applications: [...store.applications.values()],
      pnl,
    })
  }

  async listApplications(
    actor: FinanceActorContext,
    orgId: string,
    filters?: { bookId?: string; projectId?: string; applicationId?: string },
  ): Promise<TimeCostApplication[]> {
    const store = await this.load()
    authorizeFinanceAction(
      actor,
      { orgId, legalEntityId: actor.assignments[0]?.legalEntityId || 'unknown', bookId: filters?.bookId },
      'job_costing.read',
      this.now(),
    )
    // Prefer entity-scoped assignment check via any covering assignment for org.
    if (actor.orgId !== orgId) throw new FinanceValidationError('Organization scope mismatch')
    let rows = [...store.applications.values()].filter((a) => a.orgId === orgId)
    if (filters?.bookId) rows = rows.filter((a) => a.bookId === filters.bookId)
    if (filters?.projectId) rows = rows.filter((a) => a.projectIds.includes(filters.projectId!))
    if (filters?.applicationId) rows = rows.filter((a) => a.id === filters.applicationId)
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
}
