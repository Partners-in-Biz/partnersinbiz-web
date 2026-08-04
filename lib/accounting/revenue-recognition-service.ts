import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import { createHash } from 'crypto'
import { parseCanonicalDate, requiredText } from './foundation'
import {
  assertNonNegativeMinor,
  assertPositiveMinor,
  assertRecognitionMethod,
  buildMilestoneRevenueSchedule,
  buildRecognitionJournalLines,
  buildReversalJournalLines,
  buildStraightLineRevenueSchedule,
  comparePeriodKeys,
  deferredBalanceFrom,
  FinanceValidationError,
  parsePeriodKey,
  pendingLinesForPeriod,
  recognizedBps,
  scheduleLinesTotal,
} from './revenue-recognition'
import type {
  DeferredRevenueReport,
  RecognizedVsBilledReport,
  RecognitionRun,
  RecognitionRunItem,
  RevenueRecognitionAuditEvent,
  RevenueRecognitionBundle,
  RevenueSchedule,
  RevenueScheduleLine,
} from './revenue-recognition-types'

export { FinanceValidationError }

export class RevenueRecognitionNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'RevenueRecognitionNotFoundError'
  }
}

export interface RevenueRecognitionStore {
  schedules: Map<string, RevenueSchedule>
  recognitionRuns: Map<string, RecognitionRun>
  auditEvents: Map<string, RevenueRecognitionAuditEvent>
  claims: Set<string>
  idempotency: Map<string, { operation: string; resultId: string }>
  journalMarkers: Map<string, { id: string; purpose: string; balanced: true; externalEgressAllowed: false }>
}

export function createEmptyRevenueRecognitionStore(): RevenueRecognitionStore {
  return {
    schedules: new Map(),
    recognitionRuns: new Map(),
    auditEvents: new Map(),
    claims: new Set(),
    idempotency: new Map(),
    journalMarkers: new Map(),
  }
}

export function cloneRevenueRecognitionStore(store: RevenueRecognitionStore): RevenueRecognitionStore {
  return {
    schedules: new Map(store.schedules),
    recognitionRuns: new Map(store.recognitionRuns),
    auditEvents: new Map(store.auditEvents),
    claims: new Set(store.claims),
    idempotency: new Map(store.idempotency),
    journalMarkers: new Map(store.journalMarkers),
  }
}

export interface CreateRevenueScheduleCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  scheduleNumber: string
  name: string
  description?: string
  arInvoiceId?: string
  contractRef?: string
  customerName?: string
  currency: string
  method: RevenueRecognitionMethodInput
  totalContractMinor: number
  billedMinor?: number
  startDate: string
  endDate?: string
  months?: number
  milestones?: Array<{ code: string; name?: string; amountMinor: number; periodKey?: string }>
  deferredRevenueAccountId: string
  revenueAccountId: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

type RevenueRecognitionMethodInput = 'straight_line' | 'milestone'

export interface ActivateRevenueScheduleCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface CancelRevenueScheduleCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  reason: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface CreateRecognitionRunCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  periodKey: string
  periodId?: string
  postingDate: string
  description?: string
  /** Optional milestone codes to pull into this period run. */
  milestoneCodes?: string[]
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface CalculateRecognitionRunCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  milestoneCodes?: string[]
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface PostRecognitionRunCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  approvalId: string
  reason: string
  journalEntryId?: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface ReverseRecognitionRunCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  approvalId: string
  reason: string
  journalEntryId?: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export type RecognitionJournalPoster = (input: {
  actor: FinanceActorContext
  run: RecognitionRun
  journalEntryId: string
  purpose: 'revenue.recognition' | 'revenue.recognition_reversal'
  requestId: string
  idempotencyKey: string
}) => Promise<{ id: string; balanced: true }>

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function claim(store: RevenueRecognitionStore, key: string, message: string) {
  if (store.claims.has(key)) throw new FinanceValidationError(message)
  store.claims.add(key)
}

function requireScope(command: { orgId: string; legalEntityId: string; bookId: string }): Required<FinanceScope> {
  return {
    orgId: requiredText(command.orgId, 'orgId'),
    legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
    bookId: requiredText(command.bookId, 'bookId'),
  }
}

function assertExactScope(record: FinanceScope, scope: Required<FinanceScope>, label: string) {
  if (record.orgId !== scope.orgId || record.legalEntityId !== scope.legalEntityId || record.bookId !== scope.bookId) {
    throw new RevenueRecognitionNotFoundError(`${label} not found`)
  }
}

function replayIdempotent<T extends { id: string }>(
  store: RevenueRecognitionStore,
  operation: string,
  key: string,
  load: (id: string) => T | undefined,
): T | null {
  const existing = store.idempotency.get(key)
  if (!existing) return null
  if (existing.operation !== operation) {
    throw new FinanceValidationError('Idempotency key already used for a different operation')
  }
  const result = load(existing.resultId)
  if (!result) throw new FinanceValidationError('Idempotent result missing from store')
  return result
}

function rememberIdempotent(store: RevenueRecognitionStore, operation: string, key: string, resultId: string) {
  store.idempotency.set(key, { operation, resultId })
}

function pushAudit(
  store: RevenueRecognitionStore,
  scope: Required<FinanceScope>,
  actor: FinanceActorContext,
  eventType: string,
  subjectType: RevenueRecognitionAuditEvent['subjectType'],
  subjectId: string,
  summary: string,
  payload: unknown,
  now: string,
) {
  const id = `rr_audit_${digest([eventType, subjectId, now, actor.uid]).slice(0, 24)}`
  const event: RevenueRecognitionAuditEvent = {
    id,
    ...scope,
    eventType,
    subjectType,
    subjectId,
    actorUid: actor.uid,
    at: now,
    summary,
    payloadDigest: digest([payload]),
    externalEgressAllowed: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }
  store.auditEvents.set(id, event)
}

function inScopeSchedules(store: RevenueRecognitionStore, scope: Required<FinanceScope>): RevenueSchedule[] {
  return [...store.schedules.values()]
    .filter((s) => s.orgId === scope.orgId && s.legalEntityId === scope.legalEntityId && s.bookId === scope.bookId)
    .sort((a, b) => a.scheduleNumber.localeCompare(b.scheduleNumber))
}

function inScopeRuns(store: RevenueRecognitionStore, scope: Required<FinanceScope>): RecognitionRun[] {
  return [...store.recognitionRuns.values()]
    .filter((s) => s.orgId === scope.orgId && s.legalEntityId === scope.legalEntityId && s.bookId === scope.bookId)
    .sort((a, b) => comparePeriodKeys(a.periodKey, b.periodKey) || a.id.localeCompare(b.id))
}

export class RevenueRecognitionService {
  constructor(
    private readonly load: () => Promise<RevenueRecognitionStore>,
    private readonly save: (before: RevenueRecognitionStore, after: RevenueRecognitionStore) => Promise<void>,
    private readonly postJournal: RecognitionJournalPoster = async ({ journalEntryId }) => ({
      id: journalEntryId,
      balanced: true,
    }),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createSchedule(actor: FinanceActorContext, command: CreateRevenueScheduleCommand): Promise<RevenueSchedule> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.schedule.create', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.schedule.create', command.idempotencyKey, (id) => store.schedules.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.schedules.has(id)) throw new FinanceValidationError('Revenue schedule id already exists')
    if (command.expectedVersion !== 0) throw new FinanceValidationError('expectedVersion must be 0 on create')

    const scheduleNumber = requiredText(command.scheduleNumber, 'scheduleNumber')
    claim(store, `rr-schedule-number:${scope.orgId}:${scope.bookId}:${scheduleNumber}`, 'Schedule number already claimed in book')
    if (command.arInvoiceId?.trim()) {
      claim(
        store,
        `rr-ar-invoice:${scope.orgId}:${scope.bookId}:${command.arInvoiceId.trim()}`,
        'A revenue schedule is already linked to this AR invoice in the book',
      )
    }

    const method = assertRecognitionMethod(command.method)
    const totalContractMinor = assertPositiveMinor(command.totalContractMinor, 'totalContractMinor')
    const billedMinor = assertNonNegativeMinor(command.billedMinor ?? totalContractMinor, 'billedMinor')
    if (billedMinor > totalContractMinor) throw new FinanceValidationError('billedMinor cannot exceed totalContractMinor')
    parseCanonicalDate(command.startDate, 'startDate')
    if (command.endDate) parseCanonicalDate(command.endDate, 'endDate')

    const deferredRevenueAccountId = requiredText(command.deferredRevenueAccountId, 'deferredRevenueAccountId')
    const revenueAccountId = requiredText(command.revenueAccountId, 'revenueAccountId')
    if (deferredRevenueAccountId === revenueAccountId) {
      throw new FinanceValidationError('deferredRevenueAccountId and revenueAccountId must differ')
    }

    let lines: RevenueScheduleLine[]
    if (method === 'straight_line') {
      const months = command.months
      if (!months) throw new FinanceValidationError('months is required for straight_line schedules')
      lines = buildStraightLineRevenueSchedule({
        totalContractMinor,
        months,
        startDate: command.startDate,
        scheduleId: id,
      })
    } else {
      lines = buildMilestoneRevenueSchedule({
        scheduleId: id,
        totalContractMinor,
        milestones: command.milestones || [],
      })
    }
    if (scheduleLinesTotal(lines) !== totalContractMinor) {
      throw new FinanceValidationError('Schedule line total must equal totalContractMinor')
    }

    const now = this.now()
    const record: RevenueSchedule = {
      id,
      schemaVersion: 1,
      version: 1,
      ...scope,
      scheduleNumber,
      name: requiredText(command.name, 'name'),
      ...(command.description?.trim() ? { description: command.description.trim() } : {}),
      ...(command.arInvoiceId?.trim() ? { arInvoiceId: command.arInvoiceId.trim() } : {}),
      ...(command.contractRef?.trim() ? { contractRef: command.contractRef.trim() } : {}),
      ...(command.customerName?.trim() ? { customerName: command.customerName.trim() } : {}),
      currency: requiredText(command.currency, 'currency').toUpperCase(),
      method,
      status: 'draft',
      totalContractMinor,
      billedMinor,
      recognizedMinor: 0,
      deferredBalanceMinor: billedMinor,
      startDate: command.startDate,
      ...(command.endDate ? { endDate: command.endDate } : {}),
      ...(method === 'straight_line' ? { months: command.months } : {}),
      deferredRevenueAccountId,
      revenueAccountId,
      lines,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    store.schedules.set(id, record)
    rememberIdempotent(store, 'revenue.schedule.create', command.idempotencyKey, id)
    pushAudit(store, scope, actor, 'revenue.schedule.create', 'schedule', id, `Created schedule ${scheduleNumber}`, record, now)
    await this.save(await this.load(), store)
    return record
  }

  async activateSchedule(actor: FinanceActorContext, command: ActivateRevenueScheduleCommand): Promise<RevenueSchedule> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.schedule.activate', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.schedule.activate', command.idempotencyKey, (id) => store.schedules.get(id))
    if (idem) return idem

    const schedule = store.schedules.get(requiredText(command.id, 'id'))
    if (!schedule) throw new RevenueRecognitionNotFoundError('Revenue schedule not found')
    assertExactScope(schedule, scope, 'Revenue schedule')
    if (schedule.version !== command.expectedVersion) throw new FinanceValidationError('Revenue schedule version conflict')
    if (schedule.status !== 'draft') throw new FinanceValidationError('Only draft schedules can be activated')

    const now = this.now()
    const next: RevenueSchedule = {
      ...schedule,
      status: 'active',
      activatedAt: now,
      deferredBalanceMinor: deferredBalanceFrom(schedule),
      version: schedule.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
    store.schedules.set(next.id, next)
    rememberIdempotent(store, 'revenue.schedule.activate', command.idempotencyKey, next.id)
    pushAudit(store, scope, actor, 'revenue.schedule.activate', 'schedule', next.id, `Activated ${next.scheduleNumber}`, next, now)
    await this.save(await this.load(), store)
    return next
  }

  async cancelSchedule(actor: FinanceActorContext, command: CancelRevenueScheduleCommand): Promise<RevenueSchedule> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.schedule.cancel', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.schedule.cancel', command.idempotencyKey, (id) => store.schedules.get(id))
    if (idem) return idem

    const schedule = store.schedules.get(requiredText(command.id, 'id'))
    if (!schedule) throw new RevenueRecognitionNotFoundError('Revenue schedule not found')
    assertExactScope(schedule, scope, 'Revenue schedule')
    if (schedule.version !== command.expectedVersion) throw new FinanceValidationError('Revenue schedule version conflict')
    if (schedule.status === 'cancelled' || schedule.status === 'completed') {
      throw new FinanceValidationError('Schedule is already closed')
    }
    if (schedule.recognizedMinor > 0) {
      throw new FinanceValidationError('Cannot cancel a schedule with recognized revenue — reverse runs first')
    }
    requiredText(command.reason, 'reason')

    const now = this.now()
    const next: RevenueSchedule = {
      ...schedule,
      status: 'cancelled',
      cancelledAt: now,
      version: schedule.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
    store.schedules.set(next.id, next)
    rememberIdempotent(store, 'revenue.schedule.cancel', command.idempotencyKey, next.id)
    pushAudit(store, scope, actor, 'revenue.schedule.cancel', 'schedule', next.id, command.reason, { reason: command.reason }, now)
    await this.save(await this.load(), store)
    return next
  }

  async createRecognitionRun(actor: FinanceActorContext, command: CreateRecognitionRunCommand): Promise<RecognitionRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.recognition.run.create', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.recognition.run.create', command.idempotencyKey, (id) => store.recognitionRuns.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.recognitionRuns.has(id)) throw new FinanceValidationError('Recognition run id already exists')
    if (command.expectedVersion !== 0) throw new FinanceValidationError('expectedVersion must be 0 on create')
    const period = parsePeriodKey(command.periodKey)
    claim(store, `rr-run-period:${scope.orgId}:${scope.bookId}:${period.key}`, 'A recognition run already exists for this period')
    parseCanonicalDate(command.postingDate, 'postingDate')

    const now = this.now()
    const record: RecognitionRun = {
      id,
      schemaVersion: 1,
      version: 1,
      ...scope,
      periodKey: period.key,
      ...(command.periodId ? { periodId: command.periodId } : {}),
      postingDate: command.postingDate,
      status: 'draft',
      description: command.description?.trim() || `Revenue recognition ${period.key}`,
      itemCount: 0,
      totalRecognizedMinor: 0,
      items: [],
      inputDigest: digest([scope, period.key, command.postingDate, command.milestoneCodes || []]),
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    store.recognitionRuns.set(id, record)
    rememberIdempotent(store, 'revenue.recognition.run.create', command.idempotencyKey, id)
    pushAudit(store, scope, actor, 'revenue.recognition.run.create', 'recognition_run', id, record.description, record, now)
    await this.save(await this.load(), store)
    return record
  }

  async calculateRecognitionRun(actor: FinanceActorContext, command: CalculateRecognitionRunCommand): Promise<RecognitionRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.recognition.run.calculate', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.recognition.run.calculate', command.idempotencyKey, (id) => store.recognitionRuns.get(id))
    if (idem) return idem

    const run = store.recognitionRuns.get(requiredText(command.id, 'id'))
    if (!run) throw new RevenueRecognitionNotFoundError('Recognition run not found')
    assertExactScope(run, scope, 'Recognition run')
    if (run.version !== command.expectedVersion) throw new FinanceValidationError('Recognition run version conflict')
    if (run.status !== 'draft' && run.status !== 'calculated') {
      throw new FinanceValidationError('Only draft or calculated runs can be recalculated')
    }

    const items: RecognitionRunItem[] = []
    let total = 0
    for (const schedule of inScopeSchedules(store, scope)) {
      if (schedule.status !== 'active') continue
      const lines = pendingLinesForPeriod(schedule, run.periodKey, { milestoneCodes: command.milestoneCodes })
      let openingDeferred = schedule.deferredBalanceMinor
      let openingRecognized = schedule.recognizedMinor
      for (const line of lines) {
        if (line.amountMinor <= 0) continue
        if (openingDeferred < line.amountMinor) {
          throw new FinanceValidationError(
            `Insufficient deferred balance on schedule ${schedule.scheduleNumber} for line ${line.lineId}`,
          )
        }
        const closingDeferred = openingDeferred - line.amountMinor
        const closingRecognized = openingRecognized + line.amountMinor
        items.push({
          id: `${run.id}_${schedule.id}_${line.lineId}`,
          recognitionRunId: run.id,
          scheduleId: schedule.id,
          scheduleNumber: schedule.scheduleNumber,
          scheduleName: schedule.name,
          lineId: line.lineId,
          periodIndex: line.periodIndex,
          ...(line.periodKey ? { periodKey: line.periodKey } : {}),
          ...(line.milestoneCode ? { milestoneCode: line.milestoneCode } : {}),
          amountMinor: line.amountMinor,
          openingDeferredMinor: openingDeferred,
          closingDeferredMinor: closingDeferred,
          openingRecognizedMinor: openingRecognized,
          closingRecognizedMinor: closingRecognized,
          deferredRevenueAccountId: schedule.deferredRevenueAccountId,
          revenueAccountId: schedule.revenueAccountId,
        })
        total += line.amountMinor
        openingDeferred = closingDeferred
        openingRecognized = closingRecognized
      }
    }

    const now = this.now()
    const next: RecognitionRun = {
      ...run,
      status: 'calculated',
      items,
      itemCount: items.length,
      totalRecognizedMinor: total,
      calculatedAt: now,
      calculatedBy: actor.uid,
      inputDigest: digest([run.periodKey, items.map((i) => [i.scheduleId, i.lineId, i.amountMinor])]),
      version: run.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
    store.recognitionRuns.set(next.id, next)
    rememberIdempotent(store, 'revenue.recognition.run.calculate', command.idempotencyKey, next.id)
    pushAudit(store, scope, actor, 'revenue.recognition.run.calculate', 'recognition_run', next.id, `Calculated ${items.length} lines`, next, now)
    await this.save(await this.load(), store)
    return next
  }

  async postRecognitionRun(actor: FinanceActorContext, command: PostRecognitionRunCommand): Promise<RecognitionRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.recognition.run.post', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.recognition.run.post', command.idempotencyKey, (id) => store.recognitionRuns.get(id))
    if (idem) return idem

    const run = store.recognitionRuns.get(requiredText(command.id, 'id'))
    if (!run) throw new RevenueRecognitionNotFoundError('Recognition run not found')
    assertExactScope(run, scope, 'Recognition run')
    if (run.version !== command.expectedVersion) throw new FinanceValidationError('Recognition run version conflict')
    if (run.status !== 'calculated') throw new FinanceValidationError('Recognition run must be calculated before post')
    if (run.calculatedBy && run.calculatedBy === actor.uid && actor.membershipRole !== 'owner' && actor.membershipRole !== 'admin') {
      throw new FinanceValidationError('Separation of duties: calculator cannot post recognition run')
    }
    requiredText(command.approvalId, 'approvalId')
    requiredText(command.reason, 'reason')

    // Validate journal constructability for aggregated amounts
    if (run.totalRecognizedMinor > 0) {
      const byPair = new Map<string, number>()
      for (const item of run.items) {
        const key = `${item.deferredRevenueAccountId}|${item.revenueAccountId}`
        byPair.set(key, (byPair.get(key) || 0) + item.amountMinor)
      }
      for (const [pair, amount] of byPair) {
        const [deferred, revenue] = pair.split('|')
        buildRecognitionJournalLines({
          deferredRevenueAccountId: deferred,
          revenueAccountId: revenue,
          amountMinor: amount,
          description: run.description,
        })
      }
    }

    const journalEntryId = command.journalEntryId?.trim() || `jnl_revrec_${run.id}`
    const postedJournal = await this.postJournal({
      actor,
      run,
      journalEntryId,
      purpose: 'revenue.recognition',
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
    })
    store.journalMarkers.set(postedJournal.id, {
      id: postedJournal.id,
      purpose: 'revenue.recognition',
      balanced: true,
      externalEgressAllowed: false,
    })

    const now = this.now()
    const bySchedule = new Map<string, RecognitionRunItem[]>()
    for (const item of run.items) {
      const list = bySchedule.get(item.scheduleId) || []
      list.push(item)
      bySchedule.set(item.scheduleId, list)
    }

    for (const [scheduleId, items] of bySchedule) {
      const schedule = store.schedules.get(scheduleId)
      if (!schedule) throw new RevenueRecognitionNotFoundError(`Revenue schedule ${scheduleId} not found`)
      assertExactScope(schedule, scope, 'Revenue schedule')
      if (schedule.status !== 'active') throw new FinanceValidationError(`Schedule ${schedule.scheduleNumber} is not active`)

      let recognized = schedule.recognizedMinor
      let deferred = schedule.deferredBalanceMinor
      const lineMap = new Map(schedule.lines.map((l) => [l.lineId, { ...l }]))
      for (const item of items) {
        const line = lineMap.get(item.lineId)
        if (!line || line.status !== 'pending') {
          throw new FinanceValidationError(`Schedule line ${item.lineId} is not pending`)
        }
        if (line.amountMinor !== item.amountMinor) {
          throw new FinanceValidationError(`Schedule line ${item.lineId} amount changed since calculate`)
        }
        if (deferred !== item.openingDeferredMinor || recognized !== item.openingRecognizedMinor) {
          throw new FinanceValidationError(`Schedule ${schedule.scheduleNumber} balances changed since calculate`)
        }
        line.status = 'recognized'
        line.recognizedRunId = run.id
        line.recognizedAt = now
        recognized = item.closingRecognizedMinor
        deferred = item.closingDeferredMinor
        lineMap.set(item.lineId, line)
      }

      const lines = schedule.lines.map((l) => lineMap.get(l.lineId) || l)
      const allDone = lines.every((l) => l.status === 'recognized')
      const nextSchedule: RevenueSchedule = {
        ...schedule,
        lines,
        recognizedMinor: recognized,
        deferredBalanceMinor: deferred,
        lastRecognizedPeriodKey: run.periodKey,
        status: allDone ? 'completed' : 'active',
        ...(allDone ? { completedAt: now } : {}),
        version: schedule.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
      }
      store.schedules.set(nextSchedule.id, nextSchedule)
    }

    const next: RecognitionRun = {
      ...run,
      status: 'approved_posted',
      journalEntryId: postedJournal.id,
      approvalId: command.approvalId,
      approvalActorId: actor.uid,
      approvedAt: now,
      postedAt: now,
      postedBy: actor.uid,
      version: run.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
    store.recognitionRuns.set(next.id, next)
    rememberIdempotent(store, 'revenue.recognition.run.post', command.idempotencyKey, next.id)
    pushAudit(store, scope, actor, 'revenue.recognition.run.post', 'recognition_run', next.id, command.reason, next, now)
    await this.save(await this.load(), store)
    return next
  }

  async reverseRecognitionRun(actor: FinanceActorContext, command: ReverseRecognitionRunCommand): Promise<RecognitionRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'revenue.recognition.run.reverse', this.now())
    const store = cloneRevenueRecognitionStore(await this.load())
    const idem = replayIdempotent(store, 'revenue.recognition.run.reverse', command.idempotencyKey, (id) => store.recognitionRuns.get(id))
    if (idem) return idem

    const run = store.recognitionRuns.get(requiredText(command.id, 'id'))
    if (!run) throw new RevenueRecognitionNotFoundError('Recognition run not found')
    assertExactScope(run, scope, 'Recognition run')
    if (run.version !== command.expectedVersion) throw new FinanceValidationError('Recognition run version conflict')
    if (run.status !== 'approved_posted') throw new FinanceValidationError('Only posted recognition runs can be reversed')
    requiredText(command.approvalId, 'approvalId')
    requiredText(command.reason, 'reason')

    if (run.totalRecognizedMinor > 0) {
      const byPair = new Map<string, number>()
      for (const item of run.items) {
        const key = `${item.deferredRevenueAccountId}|${item.revenueAccountId}`
        byPair.set(key, (byPair.get(key) || 0) + item.amountMinor)
      }
      for (const [pair, amount] of byPair) {
        const [deferred, revenue] = pair.split('|')
        buildReversalJournalLines({
          deferredRevenueAccountId: deferred,
          revenueAccountId: revenue,
          amountMinor: amount,
          description: `Reverse ${run.description}`,
        })
      }
    }

    const journalEntryId = command.journalEntryId?.trim() || `jnl_revrec_rev_${run.id}`
    const postedJournal = await this.postJournal({
      actor,
      run,
      journalEntryId,
      purpose: 'revenue.recognition_reversal',
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
    })
    store.journalMarkers.set(postedJournal.id, {
      id: postedJournal.id,
      purpose: 'revenue.recognition_reversal',
      balanced: true,
      externalEgressAllowed: false,
    })

    const now = this.now()
    const bySchedule = new Map<string, RecognitionRunItem[]>()
    for (const item of run.items) {
      const list = bySchedule.get(item.scheduleId) || []
      list.push(item)
      bySchedule.set(item.scheduleId, list)
    }

    for (const [scheduleId, items] of bySchedule) {
      const schedule = store.schedules.get(scheduleId)
      if (!schedule) throw new RevenueRecognitionNotFoundError(`Revenue schedule ${scheduleId} not found`)
      assertExactScope(schedule, scope, 'Revenue schedule')

      let recognized = schedule.recognizedMinor
      let deferred = schedule.deferredBalanceMinor
      const lineMap = new Map(schedule.lines.map((l) => [l.lineId, { ...l }]))
      // reverse in reverse order of recognition
      for (const item of [...items].reverse()) {
        const line = lineMap.get(item.lineId)
        if (!line || line.status !== 'recognized' || line.recognizedRunId !== run.id) {
          throw new FinanceValidationError(`Cannot reverse line ${item.lineId} — not recognized by this run`)
        }
        line.status = 'pending'
        delete line.recognizedRunId
        delete line.recognizedAt
        recognized -= item.amountMinor
        deferred += item.amountMinor
        lineMap.set(item.lineId, line)
      }
      if (recognized < 0 || deferred < 0) throw new FinanceValidationError('Reversal would produce negative balances')

      const lines = schedule.lines.map((l) => lineMap.get(l.lineId) || l)
      const nextSchedule: RevenueSchedule = {
        ...schedule,
        lines,
        recognizedMinor: recognized,
        deferredBalanceMinor: deferred,
        status: schedule.status === 'completed' ? 'active' : schedule.status === 'cancelled' ? 'cancelled' : 'active',
        completedAt: undefined,
        version: schedule.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
      }
      // strip completedAt if reopened
      if ('completedAt' in nextSchedule && nextSchedule.status === 'active') {
        delete (nextSchedule as { completedAt?: string }).completedAt
      }
      store.schedules.set(nextSchedule.id, nextSchedule)
    }

    const next: RecognitionRun = {
      ...run,
      status: 'reversed',
      reversalJournalEntryId: postedJournal.id,
      reverseApprovalId: command.approvalId,
      reverseReason: command.reason,
      reversedAt: now,
      reversedBy: actor.uid,
      version: run.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
    store.recognitionRuns.set(next.id, next)
    rememberIdempotent(store, 'revenue.recognition.run.reverse', command.idempotencyKey, next.id)
    pushAudit(store, scope, actor, 'revenue.recognition.run.reverse', 'recognition_run', next.id, command.reason, next, now)
    await this.save(await this.load(), store)
    return next
  }

  async getBundle(actor: FinanceActorContext, scopeInput: FinanceScope): Promise<RevenueRecognitionBundle> {
    const scope = requireScope(scopeInput as Required<FinanceScope>)
    authorizeFinanceAction(actor, scope, 'revenue.read', this.now())
    const store = await this.load()
    const schedules = inScopeSchedules(store, scope)
    const recognitionRuns = inScopeRuns(store, scope)
    const auditEvents = [...store.auditEvents.values()]
      .filter((e) => e.orgId === scope.orgId && e.legalEntityId === scope.legalEntityId && e.bookId === scope.bookId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 100)
    return {
      schedules,
      recognitionRuns,
      auditEvents,
      hardGates: {
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
      },
    }
  }

  async getSchedule(actor: FinanceActorContext, scopeInput: FinanceScope, scheduleId: string): Promise<RevenueSchedule> {
    const scope = requireScope(scopeInput as Required<FinanceScope>)
    authorizeFinanceAction(actor, scope, 'revenue.read', this.now())
    const store = await this.load()
    const schedule = store.schedules.get(requiredText(scheduleId, 'scheduleId'))
    if (!schedule) throw new RevenueRecognitionNotFoundError('Revenue schedule not found')
    assertExactScope(schedule, scope, 'Revenue schedule')
    return schedule
  }

  async getRecognitionRun(actor: FinanceActorContext, scopeInput: FinanceScope, runId: string): Promise<RecognitionRun> {
    const scope = requireScope(scopeInput as Required<FinanceScope>)
    authorizeFinanceAction(actor, scope, 'revenue.read', this.now())
    const store = await this.load()
    const run = store.recognitionRuns.get(requiredText(runId, 'runId'))
    if (!run) throw new RevenueRecognitionNotFoundError('Recognition run not found')
    assertExactScope(run, scope, 'Recognition run')
    return run
  }

  async deferredRevenueReport(
    actor: FinanceActorContext,
    scopeInput: FinanceScope,
    asOfPeriodKey: string,
  ): Promise<DeferredRevenueReport> {
    const scope = requireScope(scopeInput as Required<FinanceScope>)
    authorizeFinanceAction(actor, scope, 'revenue.report.read', this.now())
    parsePeriodKey(asOfPeriodKey)
    const store = await this.load()
    const schedules = inScopeSchedules(store, scope).filter((s) => s.status === 'active' || s.status === 'completed')
    const lines = schedules.map((s) => ({
      scheduleId: s.id,
      scheduleNumber: s.scheduleNumber,
      name: s.name,
      method: s.method,
      status: s.status,
      billedMinor: s.billedMinor,
      recognizedMinor: s.recognizedMinor,
      deferredBalanceMinor: s.deferredBalanceMinor,
      currency: s.currency,
      ...(s.arInvoiceId ? { arInvoiceId: s.arInvoiceId } : {}),
      ...(s.contractRef ? { contractRef: s.contractRef } : {}),
      ...(s.lastRecognizedPeriodKey ? { lastRecognizedPeriodKey: s.lastRecognizedPeriodKey } : {}),
    }))
    const totalBilledMinor = lines.reduce((a, l) => a + l.billedMinor, 0)
    const totalRecognizedMinor = lines.reduce((a, l) => a + l.recognizedMinor, 0)
    const totalDeferredMinor = lines.reduce((a, l) => a + l.deferredBalanceMinor, 0)
    return {
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      asOfPeriodKey: parsePeriodKey(asOfPeriodKey).key,
      generatedAt: this.now(),
      currency: schedules[0]?.currency || 'ZAR',
      scheduleCount: lines.length,
      totalBilledMinor,
      totalRecognizedMinor,
      totalDeferredMinor,
      lines,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
  }

  async recognizedVsBilledReport(
    actor: FinanceActorContext,
    scopeInput: FinanceScope,
    asOfPeriodKey: string,
  ): Promise<RecognizedVsBilledReport> {
    const deferred = await this.deferredRevenueReport(actor, scopeInput, asOfPeriodKey)
    return {
      orgId: deferred.orgId,
      legalEntityId: deferred.legalEntityId,
      bookId: deferred.bookId,
      asOfPeriodKey: deferred.asOfPeriodKey,
      generatedAt: deferred.generatedAt,
      currency: deferred.currency,
      totalBilledMinor: deferred.totalBilledMinor,
      totalRecognizedMinor: deferred.totalRecognizedMinor,
      totalDeferredMinor: deferred.totalDeferredMinor,
      recognizedBps: recognizedBps(deferred.totalRecognizedMinor, deferred.totalBilledMinor),
      lines: deferred.lines,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
  }
}

export class InMemoryRevenueRecognitionService extends RevenueRecognitionService {
  readonly storeRef: { current: RevenueRecognitionStore }

  constructor(initial?: RevenueRecognitionStore, now?: () => string) {
    const storeRef = { current: initial ? cloneRevenueRecognitionStore(initial) : createEmptyRevenueRecognitionStore() }
    super(
      async () => cloneRevenueRecognitionStore(storeRef.current),
      async (_before, after) => {
        storeRef.current = cloneRevenueRecognitionStore(after)
      },
      async ({ journalEntryId, purpose }) => {
        storeRef.current.journalMarkers.set(journalEntryId, {
          id: journalEntryId,
          purpose,
          balanced: true,
          externalEgressAllowed: false,
        })
        return { id: journalEntryId, balanced: true as const }
      },
      now,
    )
    this.storeRef = storeRef
  }
}
