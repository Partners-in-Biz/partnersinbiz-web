import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  assertOperatorResourceKind,
  assertSavedViewName,
  buildBulkSelectionPlan,
  buildPeriodCloseCommandCentre,
  normalizeOperatorFilters,
  planMultiDocumentAllocation,
  planPartialAllocation,
} from '@/lib/accounting/operator-depth'
import type {
  BulkSelectionPlan,
  FinanceSavedView,
  MultiAllocatePlan,
  OperatorAdvancedFilters,
  OperatorDepthAuditEvent,
  OperatorListResourceKind,
  OverpayMode,
  PeriodCloseCommandCentre,
} from '@/lib/accounting/operator-depth-types'

export class OperatorDepthValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'OperatorDepthValidationError'
  }
}

export class OperatorDepthNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'OperatorDepthNotFoundError'
  }
}

export type OperatorDepthStore = {
  savedViews: Map<string, FinanceSavedView>
  auditEvents: Map<string, OperatorDepthAuditEvent>
  claims: Set<string>
}

export function createEmptyOperatorDepthStore(): OperatorDepthStore {
  return { savedViews: new Map(), auditEvents: new Map(), claims: new Set() }
}

export function cloneOperatorDepthStore(store: OperatorDepthStore): OperatorDepthStore {
  return {
    savedViews: new Map(store.savedViews),
    auditEvents: new Map(store.auditEvents),
    claims: new Set(store.claims),
  }
}

type Scope = { orgId: string; legalEntityId: string; bookId: string }

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new OperatorDepthValidationError(`${field} is required`)
  return value.trim()
}

function assertScopeMatch<T extends Scope>(row: T | undefined, scope: Scope, label: string): T {
  if (!row || row.orgId !== scope.orgId || row.legalEntityId !== scope.legalEntityId || row.bookId !== scope.bookId) {
    throw new OperatorDepthNotFoundError(`${label} not found`)
  }
  return row
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export type UpsertSavedViewCommand = Scope & {
  id?: string
  resourceKind: OperatorListResourceKind
  name: string
  filters: OperatorAdvancedFilters
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  expectedVersion?: number
}

export type DeleteSavedViewCommand = Scope & {
  id: string
  expectedVersion: number
}

export type BulkSelectionCommand = Scope & {
  id?: string
  action: BulkSelectionPlan['action']
  resourceKind: OperatorListResourceKind
  rows: Array<{ id: string; status?: string }>
  filters?: OperatorAdvancedFilters
  explicitIds?: string[]
  selectAllFiltered?: boolean
  maxTargets?: number
}

export type AllocationPlanCommand = Scope & {
  id?: string
  paymentId: string
  paymentUnallocatedMinor: number
  mode: 'partial' | 'multi' | 'overpay'
  overpayMode?: OverpayMode
  // partial
  targetType?: 'customer_invoice' | 'supplier_bill' | 'open_item'
  targetId?: string
  outstandingMinor?: number
  allocatedMinor?: number
  discountMinor?: number
  writeOffMinor?: number
  openItemId?: string
  // multi
  targets?: Array<{
    targetType: 'customer_invoice' | 'supplier_bill' | 'open_item'
    targetId: string
    outstandingMinor: number
    openItemId?: string
    discountMinor?: number
    writeOffMinor?: number
  }>
}

export type PeriodCloseQuery = Scope & {
  asOfDate: string
  periodId?: string
  periodLabel?: string
  reconciliations?: Array<{ id: string; status?: string }>
  journals?: Array<{ id: string; status?: string; approvalStatus?: string }>
  payRuns?: Array<{ id: string; status?: string }>
  fxRevaluationRuns?: Array<{ id: string; status?: string; periodId?: string; asOfDate?: string }>
  cutoverPackages?: Array<{ id: string; status?: string }>
  requireFxReval?: boolean
  requireCutoverComplete?: boolean
}

export class OperatorDepthFinanceService {
  constructor(
    private readonly load: () => Promise<OperatorDepthStore>,
    private readonly save: (before: OperatorDepthStore, after: OperatorDepthStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async transact<T>(orgId: string, fn: (state: OperatorDepthStore) => T): Promise<T> {
    const before = await this.load()
    const state = cloneOperatorDepthStore(before)
    const result = fn(state)
    await this.save(before, state)
    return result
  }

  private appendAudit(
    state: OperatorDepthStore,
    scope: Scope,
    actor: FinanceActorContext,
    action: string,
    subjectType: string,
    subjectId: string,
    metadata: Record<string, unknown>,
  ) {
    const id = newId('oda')
    const event: OperatorDepthAuditEvent = {
      id,
      ...scope,
      action,
      subjectType,
      subjectId,
      actorUserId: actor.uid,
      at: this.now(),
      metadata: {
        ...metadata,
        externalEgressAllowed: false,
        externalPaymentInitiated: false,
      },
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
    }
    state.auditEvents.set(id, event)
    return event
  }

  async upsertSavedView(actor: FinanceActorContext, command: UpsertSavedViewCommand): Promise<FinanceSavedView> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'operator_view.write', this.now())
    const resourceKind = assertOperatorResourceKind(command.resourceKind)
    const name = assertSavedViewName(command.name)
    const filters = normalizeOperatorFilters(command.filters || {})
    return this.transact(command.orgId, (state) => {
      const now = this.now()
      if (command.id) {
        const existing = assertScopeMatch(state.savedViews.get(command.id), scope, 'Saved view')
        if (existing.ownerUserId !== actor.uid && actor.membershipRole !== 'owner' && actor.membershipRole !== 'admin') {
          throw new OperatorDepthNotFoundError('Saved view not found')
        }
        const expected = command.expectedVersion ?? existing.version
        if (existing.version !== expected) throw new OperatorDepthValidationError('Saved view version mismatch')
        const updated: FinanceSavedView = {
          ...existing,
          name,
          resourceKind,
          filters,
          ...(command.sortKey ? { sortKey: command.sortKey } : { sortKey: undefined }),
          ...(command.sortDir ? { sortDir: command.sortDir } : { sortDir: undefined }),
          version: existing.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        }
        // strip undefined optionals
        if (!command.sortKey) delete (updated as any).sortKey
        if (!command.sortDir) delete (updated as any).sortDir
        state.savedViews.set(updated.id, updated)
        this.appendAudit(state, scope, actor, 'operator_view.upsert', 'saved_view', updated.id, {
          resourceKind,
          name,
          version: updated.version,
        })
        return updated
      }
      const claim = `saved_view:${scope.orgId}:${scope.bookId}:${actor.uid}:${resourceKind}:${name.toLowerCase()}`
      if (state.claims.has(claim)) throw new OperatorDepthValidationError('Saved view name already exists for this resource')
      state.claims.add(claim)
      const created: FinanceSavedView = {
        id: newId('osv'),
        ...scope,
        ownerUserId: actor.uid,
        resourceKind,
        name,
        filters,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        ...(command.sortKey ? { sortKey: command.sortKey } : {}),
        ...(command.sortDir ? { sortDir: command.sortDir } : {}),
      }
      state.savedViews.set(created.id, created)
      this.appendAudit(state, scope, actor, 'operator_view.upsert', 'saved_view', created.id, {
        resourceKind,
        name,
        version: 1,
      })
      return created
    })
  }

  async deleteSavedView(actor: FinanceActorContext, command: DeleteSavedViewCommand): Promise<{ id: string; deleted: true }> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'operator_view.write', this.now())
    return this.transact(command.orgId, (state) => {
      const existing = assertScopeMatch(state.savedViews.get(command.id), scope, 'Saved view')
      if (existing.ownerUserId !== actor.uid && actor.membershipRole !== 'owner' && actor.membershipRole !== 'admin') {
        throw new OperatorDepthNotFoundError('Saved view not found')
      }
      if (existing.version !== command.expectedVersion) throw new OperatorDepthValidationError('Saved view version mismatch')
      state.savedViews.delete(existing.id)
      const claim = `saved_view:${scope.orgId}:${scope.bookId}:${existing.ownerUserId}:${existing.resourceKind}:${existing.name.toLowerCase()}`
      state.claims.delete(claim)
      this.appendAudit(state, scope, actor, 'operator_view.delete', 'saved_view', existing.id, {
        resourceKind: existing.resourceKind,
        name: existing.name,
      })
      return { id: existing.id, deleted: true as const }
    })
  }

  async planBulkSelection(actor: FinanceActorContext, command: BulkSelectionCommand): Promise<BulkSelectionPlan & { auditId: string }> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'operator_bulk.plan', this.now())
    // planning is read-side with audit; actual mutate still goes through documents bulk_* 
    let plan: BulkSelectionPlan
    try {
      plan = buildBulkSelectionPlan({
        action: command.action,
        resourceKind: command.resourceKind,
        rows: command.rows || [],
        filters: command.filters,
        explicitIds: command.explicitIds,
        selectAllFiltered: command.selectAllFiltered === true,
        maxTargets: command.maxTargets,
      })
    } catch (err) {
      throw new OperatorDepthValidationError(err instanceof Error ? err.message : 'Invalid bulk selection')
    }
    return this.transact(command.orgId, (state) => {
      const audit = this.appendAudit(state, scope, actor, 'operator_bulk.selection_planned', 'bulk_selection', command.id || newId('bulk'), {
        action: plan.action,
        resourceKind: plan.resourceKind,
        selectAllFiltered: plan.selectAllFiltered,
        filteredCount: plan.filteredCount,
        selectedCount: plan.selectedIds.length,
        capped: plan.capped,
        selectedIds: plan.selectedIds,
      })
      return { ...plan, auditId: audit.id }
    })
  }

  async planAllocation(actor: FinanceActorContext, command: AllocationPlanCommand): Promise<MultiAllocatePlan & { auditId: string }> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'operator_allocate.plan', this.now())
    let plan: MultiAllocatePlan
    try {
      if (command.mode === 'partial') {
        plan = planPartialAllocation({
          paymentId: requiredText(command.paymentId, 'paymentId'),
          paymentUnallocatedMinor: command.paymentUnallocatedMinor,
          targetType: command.targetType as any,
          targetId: requiredText(command.targetId, 'targetId'),
          outstandingMinor: command.outstandingMinor as number,
          allocatedMinor: command.allocatedMinor as number,
          discountMinor: command.discountMinor,
          writeOffMinor: command.writeOffMinor,
          openItemId: command.openItemId,
        })
      } else {
        // multi + overpay use multi planner
        plan = planMultiDocumentAllocation({
          paymentId: requiredText(command.paymentId, 'paymentId'),
          paymentUnallocatedMinor: command.paymentUnallocatedMinor,
          targets: command.targets || [],
          overpayMode: command.overpayMode || (command.mode === 'overpay' ? 'on_account' : 'on_account'),
        })
      }
    } catch (err) {
      throw new OperatorDepthValidationError(err instanceof Error ? err.message : 'Invalid allocation plan')
    }
    if (plan.externalPaymentInitiated !== false) {
      throw new OperatorDepthValidationError('Allocation plan must not initiate external payment')
    }
    return this.transact(command.orgId, (state) => {
      const audit = this.appendAudit(state, scope, actor, 'operator_allocate.planned', 'allocation_plan', command.paymentId, {
        mode: command.mode,
        lineCount: plan.lines.length,
        allocatedTotalMinor: plan.allocatedTotalMinor,
        remainderMinor: plan.remainderMinor,
        overpayMode: plan.overpayMode,
        lines: plan.lines,
        externalPaymentInitiated: false,
      })
      return { ...plan, auditId: audit.id }
    })
  }

  async getPeriodCloseCentre(actor: FinanceActorContext, query: PeriodCloseQuery): Promise<PeriodCloseCommandCentre> {
    const scope = { orgId: query.orgId, legalEntityId: query.legalEntityId, bookId: query.bookId }
    authorizeFinanceAction(actor, scope, 'period_close.read', this.now())
    try {
      return buildPeriodCloseCommandCentre({
        ...query,
        asOfDate: requiredText(query.asOfDate, 'asOfDate'),
      })
    } catch (err) {
      throw new OperatorDepthValidationError(err instanceof Error ? err.message : 'Invalid period-close query')
    }
  }

  async getBundle(actor: FinanceActorContext, orgId: string, legalEntityId: string, bookId: string, resourceKind?: string) {
    const scope = { orgId, legalEntityId, bookId }
    authorizeFinanceAction(actor, scope, 'operator_view.read', this.now())
    const store = await this.load()
    const views = [...store.savedViews.values()]
      .filter((v) => v.orgId === orgId && v.legalEntityId === legalEntityId && v.bookId === bookId)
      .filter((v) => v.ownerUserId === actor.uid || actor.membershipRole === 'owner' || actor.membershipRole === 'admin')
      .filter((v) => !resourceKind || v.resourceKind === resourceKind)
      .sort((a, b) => a.name.localeCompare(b.name))
    const audits = [...store.auditEvents.values()]
      .filter((e) => e.orgId === orgId && e.legalEntityId === legalEntityId && e.bookId === bookId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50)
    return {
      savedViews: views,
      recentAudit: audits,
      externalPaymentInitiated: false as const,
      externalEgressAllowed: false as const,
      sarsSubmissionInitiated: false as const,
    }
  }
}
