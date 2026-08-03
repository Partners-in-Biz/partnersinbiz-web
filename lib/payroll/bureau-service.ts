import { authorizeFinanceAction } from '@/lib/finance/policy'
import { authorizePayslipRead } from '@/lib/finance/payroll-access'
import {
  CANONICAL_PAYLOAD_VERSION,
  HASH_ALGORITHM_VERSION,
  canonicalDigest,
  canonicalScopeIdentity,
  scopedClaimId,
} from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import {
  FinanceValidationError,
  assertCreateVersion,
  assertEnumValue,
  requiredText,
} from '@/lib/accounting/foundation'
import {
  buildBulkPayslipRunPackFiles,
  buildEmp501AnnualReadinessPack,
  buildLeaveMonthCalendar,
  buildMultiEntityPayRunBoard,
  buildSalaryStructureContentHash,
  salaryStructureToPeriodComponents,
} from './bureau'
import type {
  BulkPayslipRunPack,
  Emp501AnnualReadinessPack,
  LeaveMonthCalendar,
  MultiEntityPayRunBoard,
  SalaryStructureLine,
  SalaryStructureTemplate,
} from './bureau-types'
import type { PeriodComponentInput } from './types'
import type { InMemoryPayrollStore, PayrollServiceState } from './calculation-service'
import { listVeraCalcFixtureIds, runAllVeraCalcFixtures, runVeraCalcFixture } from './vera-calc-fixtures'

interface CommandIdentity {
  requestId: string
  idempotencyKey: string
}

export interface CreateSalaryStructureCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  code: string
  name: string
  frequency: 'monthly' | 'weekly'
  lines: SalaryStructureLine[]
  notes?: string
  expectedVersion: 0
}

export interface ActivateSalaryStructureCommand extends Required<FinanceScope>, CommandIdentity {
  structureId: string
  expectedVersion: number
}

export interface ExpandSalaryStructureCommand extends Required<FinanceScope>, CommandIdentity {
  structureId: string
}

export interface BuildBulkPayslipRunPackCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  payRunId: string
  expectedVersion: 0
}

export interface MarkBulkPayslipRunPackDownloadedCommand extends Required<FinanceScope>, CommandIdentity {
  packId: string
}

export interface BuildEmp501AnnualPackCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  emp501Id: string
  expectedVersion: 0
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
function scopeOf(command: Required<FinanceScope>): Required<FinanceScope> {
  return {
    orgId: requiredText(command.orgId, 'orgId'),
    legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
    bookId: requiredText(command.bookId, 'bookId'),
  }
}
function scopedGet<T extends { orgId: string; legalEntityId: string; bookId: string }>(
  map: Map<string, T>,
  id: string,
  scope: Required<FinanceScope>,
  label: string,
): T {
  const row = map.get(id)
  if (!row || row.orgId !== scope.orgId || row.legalEntityId !== scope.legalEntityId || row.bookId !== scope.bookId) {
    throw new FinanceValidationError(`${label} not found in scope`)
  }
  return row
}
function claim(state: PayrollServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}
function idempotencyInput(
  state: PayrollServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  now: string,
) {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('payroll_idempotency', scope, {
    actorId: actor.uid,
    key: (command as CommandIdentity).idempotencyKey,
    operation,
  })
  const retry = state.idempotency.get(claimId)
  if (!retry) return { claimId, payloadDigest }
  if (
    retry.schemaVersion !== 1 ||
    retry.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
    retry.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION ||
    retry.actorId !== actor.uid ||
    retry.orgId !== scope.orgId ||
    retry.scopeIdentity !== canonicalScopeIdentity(scope) ||
    retry.operation !== operation ||
    retry.requestId !== (command as CommandIdentity).requestId ||
    retry.expiresAt <= now
  ) {
    throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
  }
  if (retry.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
  return { retryId: retry.aggregateId, claimId, payloadDigest }
}
function storeIdempotency(
  state: PayrollServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  aggregateId: string,
  claimId: string,
  payloadDigest: string,
  now: string,
  result: unknown,
): void {
  const compactResult = compactUndefined(result as Record<string, unknown>)
  state.idempotency.set(claimId, {
    schemaVersion: 1,
    canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    payloadDigest,
    aggregateId,
    operation,
    actorId: actor.uid,
    orgId: scope.orgId,
    scopeIdentity: canonicalScopeIdentity(scope),
    requestId: (command as CommandIdentity).requestId,
    expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    resultSnapshot: structuredClone(compactResult),
    resultDigest: canonicalDigest(compactResult),
  })
}
function appendAudit(
  state: PayrollServiceState,
  scope: FinanceScope,
  actor: FinanceActorContext,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  now: string,
  command: CommandIdentity,
  payload: Record<string, unknown>,
  reason?: string,
): void {
  const scopeIdentity = canonicalScopeIdentity(scope)
  const previous = [...state.auditEvents].reverse().find((event) => canonicalScopeIdentity(event) === scopeIdentity)
  const sequence = (previous?.sequence ?? 0) + 1
  const base = {
    id: `praud_${scope.orgId}_${sequence}`,
    schemaVersion: 1 as const,
    orgId: scope.orgId,
    legalEntityId: scope.legalEntityId,
    ...(scope.bookId ? { bookId: scope.bookId } : {}),
    aggregateType,
    aggregateId,
    aggregateVersion,
    eventType,
    actorId: actor.uid,
    requestId: command.requestId,
    idempotencyKey: command.idempotencyKey,
    occurredAt: now,
    sequence,
    ...(previous ? { previousEventId: previous.id, previousEventHash: previous.eventHash } : {}),
    payload: compactUndefined(payload),
    externalEgressAllowed: false as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    ...(reason ? { reason } : {}),
  }
  state.auditEvents.push({ ...base, eventHash: canonicalDigest(base) })
}
function versionedBase(id: string, scope: Required<FinanceScope>, actorId: string, now: string) {
  return {
    id,
    schemaVersion: 1 as const,
    orgId: scope.orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    version: 1,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  }
}

function validateStructureLines(lines: SalaryStructureLine[]): SalaryStructureLine[] {
  if (!Array.isArray(lines) || lines.length < 1) throw new FinanceValidationError('Salary structure requires at least one line')
  return lines.map((line, index) => {
    if (!line.lineId) throw new FinanceValidationError(`lines[${index}].lineId is required`)
    if (!line.componentCode?.trim()) throw new FinanceValidationError(`lines[${index}].componentCode is required`)
    if (!Number.isFinite(line.unitAmountMinor) || line.unitAmountMinor < 0) {
      throw new FinanceValidationError(`lines[${index}].unitAmountMinor must be non-negative`)
    }
    if (!Number.isFinite(line.quantityMinorUnits) || line.quantityMinorUnits <= 0) {
      throw new FinanceValidationError(`lines[${index}].quantityMinorUnits must be positive`)
    }
    return {
      ...line,
      componentCode: line.componentCode.trim().toUpperCase(),
      description: requiredText(line.description || line.componentCode, 'description'),
    }
  })
}

export class FinancePayrollBureauService {
  constructor(
    private readonly store: InMemoryPayrollStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  projectPayRunBoard(
    actor: FinanceActorContext,
    scope: Required<FinanceScope>,
    options?: { windowStart?: string; windowEnd?: string; entityLabel?: string; bookLabel?: string },
  ): MultiEntityPayRunBoard {
    authorizeFinanceAction(actor, scope, 'payroll.bureau.read', this.now())
    const runs = [...this.store.payRuns.values()].filter(
      (r) => r.orgId === scope.orgId && r.legalEntityId === scope.legalEntityId && r.bookId === scope.bookId,
    )
    const periods = [...this.store.periods.values()].filter(
      (p) => p.orgId === scope.orgId && p.legalEntityId === scope.legalEntityId && p.bookId === scope.bookId,
    )
    const calendars = [...this.store.calendars.values()].filter(
      (c) => c.orgId === scope.orgId && c.legalEntityId === scope.legalEntityId && c.bookId === scope.bookId,
    )
    return buildMultiEntityPayRunBoard({
      entities: [
        {
          legalEntityId: scope.legalEntityId,
          legalEntityLabel: options?.entityLabel ?? scope.legalEntityId,
          bookId: scope.bookId,
          bookLabel: options?.bookLabel ?? scope.bookId,
          payRuns: runs,
          periods,
          calendars,
        },
      ],
      nowIso: this.now(),
      windowStart: options?.windowStart,
      windowEnd: options?.windowEnd,
    })
  }

  /**
   * Merge pre-hydrated entity snapshots (caller authorizes each scope separately).
   * Used by gateway multi-entity board query.
   */
  static mergeEntityBoards(
    entities: Parameters<typeof buildMultiEntityPayRunBoard>[0]['entities'],
    nowIso: string,
    window?: { windowStart?: string; windowEnd?: string },
  ): MultiEntityPayRunBoard {
    return buildMultiEntityPayRunBoard({ entities, nowIso, ...window })
  }

  projectLeaveMonth(
    actor: FinanceActorContext,
    scope: Required<FinanceScope>,
    year: number,
    month: number,
  ): LeaveMonthCalendar {
    authorizeFinanceAction(actor, scope, 'payroll.leave.read', this.now())
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new FinanceValidationError('year invalid')
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new FinanceValidationError('month invalid')
    const inScope = <T extends { orgId: string; legalEntityId: string; bookId: string }>(row: T) =>
      row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId
    return buildLeaveMonthCalendar({
      year,
      month,
      leaveRecords: [...this.store.leaveRecords.values()].filter(inScope),
      leaveBalances: [...this.store.leaveBalances.values()].filter(inScope),
      leaveTypes: [...this.store.leaveTypes.values()].filter(inScope),
      employees: [...this.store.employees.values()].filter(inScope),
    })
  }

  async createSalaryStructure(actor: FinanceActorContext, command: CreateSalaryStructureCommand): Promise<SalaryStructureTemplate> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'salary structure')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.structure.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.salary_structure.create', command, now)
      if (idem.retryId) return structuredClone(state.salaryStructures.get(idem.retryId)!)
      assertEnumValue(command.frequency, ['monthly', 'weekly'] as const, 'frequency')
      const lines = validateStructureLines(command.lines)
      claim(state, 'salary_structure_code', scope, command.code.trim().toUpperCase(), command.id, 'Salary structure code already exists')
      claim(state, 'salary_structure_id', scope, command.id, command.id, 'Salary structure id already exists')
      const base = {
        ...versionedBase(command.id, scope, actor.uid, now),
        code: requiredText(command.code, 'code').toUpperCase(),
        name: requiredText(command.name, 'name'),
        frequency: command.frequency,
        status: 'draft' as const,
        lines,
        ...(command.notes ? { notes: command.notes } : {}),
      }
      const structure: SalaryStructureTemplate = {
        ...base,
        contentHash: buildSalaryStructureContentHash(base),
      }
      state.salaryStructures.set(structure.id, structure)
      appendAudit(state, scope, actor, 'payroll.salary_structure.created', 'salary_structure', structure.id, structure.version, now, command, {
        code: structure.code,
        lineCount: structure.lines.length,
      })
      storeIdempotency(state, actor, scope, 'payroll.salary_structure.create', command, structure.id, idem.claimId, idem.payloadDigest, now, structure)
      return structuredClone(structure)
    })
  }

  async activateSalaryStructure(actor: FinanceActorContext, command: ActivateSalaryStructureCommand): Promise<SalaryStructureTemplate> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.structure.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.salary_structure.activate', command, now)
      if (idem.retryId) return structuredClone(state.salaryStructures.get(idem.retryId)!)
      const current = scopedGet(state.salaryStructures, command.structureId, scope, 'Salary structure')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('Salary structure version mismatch')
      if (current.status === 'archived') throw new FinanceValidationError('Cannot activate archived salary structure')
      const nextBase = {
        ...current,
        status: 'active' as const,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      const next: SalaryStructureTemplate = {
        ...nextBase,
        contentHash: buildSalaryStructureContentHash(nextBase),
      }
      state.salaryStructures.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.salary_structure.activated', 'salary_structure', next.id, next.version, now, command, {
        code: next.code,
      })
      storeIdempotency(state, actor, scope, 'payroll.salary_structure.activate', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  expandSalaryStructure(actor: FinanceActorContext, command: ExpandSalaryStructureCommand): {
    structureId: string
    components: PeriodComponentInput[]
    externalPaymentInitiated: false
    sarsSubmissionInitiated: false
  } {
    const scope = scopeOf(command)
    authorizeFinanceAction(actor, scope, 'payroll.structure.read', this.now())
    const structure = scopedGet(this.store.salaryStructures, command.structureId, scope, 'Salary structure')
    if (structure.status !== 'active' && structure.status !== 'draft') {
      throw new FinanceValidationError('Salary structure is not expandable')
    }
    return {
      structureId: structure.id,
      components: salaryStructureToPeriodComponents(structure.lines),
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    }
  }

  listSalaryStructures(actor: FinanceActorContext, scope: Required<FinanceScope>): SalaryStructureTemplate[] {
    authorizeFinanceAction(actor, scope, 'payroll.structure.read', this.now())
    return [...this.store.salaryStructures.values()]
      .filter((s) => s.orgId === scope.orgId && s.legalEntityId === scope.legalEntityId && s.bookId === scope.bookId)
      .map((s) => structuredClone(s))
  }

  async buildBulkPayslipRunPack(actor: FinanceActorContext, command: BuildBulkPayslipRunPackCommand): Promise<BulkPayslipRunPack> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'bulk payslip pack')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.payslip.read', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.bulk_payslip_pack', command, now)
      if (idem.retryId) return structuredClone(state.bulkPayslipPacks.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.status !== 'approved_locked' && run.status !== 'reversed') {
        throw new FinanceValidationError('Bulk payslip pack requires locked or reversed pay run')
      }
      const payslips = run.payslipIds.map((id) => {
        const ps = scopedGet(state.payslips, id, scope, 'Payslip')
        authorizePayslipRead(actor, scope, {
          payslipId: ps.id,
          employeeLinkedUserId: state.employees.get(ps.employeeId)?.linkedUserId,
        })
        return ps
      })
      claim(state, 'bulk_payslip_pack_id', scope, command.id, command.id, 'Bulk payslip pack id already exists')
      claim(state, 'bulk_payslip_pack_run', scope, { payRunId: run.id, slot: command.id }, command.id, 'Bulk pack claim collision')
      let built: ReturnType<typeof buildBulkPayslipRunPackFiles>
      try {
        built = buildBulkPayslipRunPackFiles({ payRun: run, payslips })
      } catch (err) {
        throw new FinanceValidationError(err instanceof Error ? err.message : 'Bulk pack build failed')
      }
      const packBase = {
        ...versionedBase(command.id, scope, actor.uid, now),
        payRunId: run.id,
        payPeriodId: run.payPeriodId,
        payslipIds: built.payslipIds,
        files: built.files,
        rowCount: built.rowCount,
        archiveFormat: 'multi_file_zip_v1' as const,
        zipBase64: built.zipBase64,
        zipFileName: built.zipFileName,
        status: 'ready' as const,
        publicationStatus: 'internal_only' as const,
        autoSent: false as const,
        externalEgressAllowed: false as const,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
      }
      const pack: BulkPayslipRunPack = {
        ...packBase,
        contentHash: canonicalDigest({
          payRunId: packBase.payRunId,
          payslipIds: packBase.payslipIds,
          zipFileName: packBase.zipFileName,
          rowCount: packBase.rowCount,
          fileNames: packBase.files.map((f) => f.name),
        }),
      }
      state.bulkPayslipPacks.set(pack.id, pack)
      appendAudit(state, scope, actor, 'payroll.bulk_payslip_pack.built', 'bulk_payslip_run_pack', pack.id, pack.version, now, command, {
        payRunId: pack.payRunId,
        payslipCount: pack.payslipIds.length,
        externalEgressAllowed: false,
        autoSent: false,
        massEmailAllowed: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.bulk_payslip_pack', command, pack.id, idem.claimId, idem.payloadDigest, now, pack)
      return structuredClone(pack)
    })
  }

  async markBulkPayslipRunPackDownloaded(
    actor: FinanceActorContext,
    command: MarkBulkPayslipRunPackDownloadedCommand,
  ): Promise<BulkPayslipRunPack> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.payslip.read', now)
      const current = scopedGet(state.bulkPayslipPacks, command.packId, scope, 'Bulk payslip pack')
      for (const payslipId of current.payslipIds) {
        const ps = scopedGet(state.payslips, payslipId, scope, 'Payslip')
        authorizePayslipRead(actor, scope, {
          payslipId: ps.id,
          employeeLinkedUserId: state.employees.get(ps.employeeId)?.linkedUserId,
        })
      }
      const next: BulkPayslipRunPack = {
        ...current,
        status: 'downloaded',
        downloadedAt: now,
        downloadedBy: actor.uid,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        autoSent: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      state.bulkPayslipPacks.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.bulk_payslip_pack.downloaded', 'bulk_payslip_run_pack', next.id, next.version, now, command, {
        payRunId: next.payRunId,
        externalEgressAllowed: false,
        autoSent: false,
      })
      return structuredClone(next)
    })
  }

  buildEmp501AnnualPack(actor: FinanceActorContext, command: BuildEmp501AnnualPackCommand): Emp501AnnualReadinessPack {
    const now = this.now()
    const scope = scopeOf(command)
    authorizeFinanceAction(actor, scope, 'payroll.statutory.read', now)
    const emp501 = scopedGet(this.store.emp501Reconciliations, command.emp501Id, scope, 'EMP501 reconciliation')
    const taxYear = scopedGet(this.store.taxYears, emp501.taxYearId, scope, 'Tax year')
    const pack = buildEmp501AnnualReadinessPack({
      id: command.id,
      taxYear,
      emp501,
      irp5Records: [...this.store.irp5Records.values()].filter(
        (r) => r.orgId === scope.orgId && r.legalEntityId === scope.legalEntityId && r.bookId === scope.bookId,
      ),
      emp201Snapshots: [...this.store.emp201Snapshots.values()].filter(
        (r) => r.orgId === scope.orgId && r.legalEntityId === scope.legalEntityId && r.bookId === scope.bookId,
      ),
    })
    // ephemeral pack — no store write required for prepare/download polish
    return pack
  }

  listVeraFixtures(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    authorizeFinanceAction(actor, scope, 'payroll.bureau.read', this.now())
    return {
      fixtureIds: listVeraCalcFixtureIds(),
      hardGates: { externalPaymentInitiated: false as const, sarsSubmissionInitiated: false as const },
    }
  }

  runVeraFixture(actor: FinanceActorContext, scope: Required<FinanceScope>, fixtureId: string) {
    authorizeFinanceAction(actor, scope, 'payroll.bureau.read', this.now())
    return runVeraCalcFixture(fixtureId)
  }

  runAllVeraFixtures(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    authorizeFinanceAction(actor, scope, 'payroll.bureau.read', this.now())
    return runAllVeraCalcFixtures()
  }
}
