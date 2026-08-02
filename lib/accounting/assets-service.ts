import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import { createHash } from 'crypto'
import {
  assertAssetActiveForDepreciation,
  assertNonNegativeMinor,
  assertPositiveMinor,
  assertUsefulLifeMonths,
  buildStraightLineSchedule,
  comparePeriodKeys,
  computeDisposalGainLoss,
  FinanceValidationError,
  netBookValueMinor,
  parsePeriodKey,
  periodKeyFromDate,
  scheduleLineForPeriod,
} from './assets'
import type {
  AssetClass,
  AssetDisposal,
  DepreciationRun,
  DepreciationRunItem,
  FixedAsset,
  FixedAssetRegisterReport,
  DepreciationRunReport,
} from './assets-types'
import { parseCanonicalDate, requiredText } from './foundation'

export { FinanceValidationError }

export class AssetsFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'AssetsFinanceNotFoundError'
  }
}

export interface AssetsFinanceStore {
  assetClasses: Map<string, AssetClass>
  assets: Map<string, FixedAsset>
  depreciationRuns: Map<string, DepreciationRun>
  disposals: Map<string, AssetDisposal>
  claims: Set<string>
  idempotency: Map<string, { operation: string; resultId: string }>
}

export function createEmptyAssetsStore(): AssetsFinanceStore {
  return {
    assetClasses: new Map(),
    assets: new Map(),
    depreciationRuns: new Map(),
    disposals: new Map(),
    claims: new Set(),
    idempotency: new Map(),
  }
}

export function cloneAssetsStore(store: AssetsFinanceStore): AssetsFinanceStore {
  return {
    assetClasses: new Map(store.assetClasses),
    assets: new Map(store.assets),
    depreciationRuns: new Map(store.depreciationRuns),
    disposals: new Map(store.disposals),
    claims: new Set(store.claims),
    idempotency: new Map(store.idempotency),
  }
}

export interface CreateAssetClassCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  code: string
  name: string
  usefulLifeMonths: number
  defaultResidualMinor?: number
  assetAccountId: string
  accumulatedDepAccountId: string
  expenseAccountId: string
  active?: boolean
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface CreateFixedAssetCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  assetNumber: string
  name: string
  description?: string
  assetClassId: string
  currency: string
  costMinor: number
  residualValueMinor?: number
  usefulLifeMonths?: number
  acquisitionDate: string
  inServiceDate: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface ActivateFixedAssetCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface CreateDepreciationRunCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  periodKey: string
  periodId?: string
  postingDate: string
  description?: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface CalculateDepreciationRunCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export interface PostDepreciationRunCommand {
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

export interface DisposeFixedAssetCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  assetId: string
  disposedAt: string
  proceedsMinor: number
  proceedsAccountId: string
  gainLossAccountId: string
  description?: string
  approvalId: string
  reason: string
  journalEntryId?: string
  expectedVersion: number
  requestId: string
  idempotencyKey: string
}

export type DepreciationJournalPoster = (input: {
  actor: FinanceActorContext
  run: DepreciationRun
  journalEntryId: string
  requestId: string
  idempotencyKey: string
}) => Promise<{ id: string }>

export type DisposalJournalPoster = (input: {
  actor: FinanceActorContext
  disposal: AssetDisposal
  asset: FixedAsset
  journalEntryId: string
  requestId: string
  idempotencyKey: string
}) => Promise<{ id: string }>

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function claim(store: AssetsFinanceStore, key: string, message: string) {
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
    throw new AssetsFinanceNotFoundError(`${label} not found`)
  }
}

function replayIdempotent<T extends { id: string }>(
  store: AssetsFinanceStore,
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

function rememberIdempotent(store: AssetsFinanceStore, operation: string, key: string, resultId: string) {
  store.idempotency.set(key, { operation, resultId })
}

export class AssetsFinanceService {
  constructor(
    private readonly load: () => Promise<AssetsFinanceStore>,
    private readonly save: (before: AssetsFinanceStore, after: AssetsFinanceStore) => Promise<void>,
    private readonly postDepreciationJournal: DepreciationJournalPoster = async ({ journalEntryId }) => ({ id: journalEntryId }),
    private readonly postDisposalJournal: DisposalJournalPoster = async ({ journalEntryId }) => ({ id: journalEntryId }),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createAssetClass(actor: FinanceActorContext, command: CreateAssetClassCommand): Promise<AssetClass> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.class.configure', this.now())
    const store = cloneAssetsStore(await this.load())
    const idem = replayIdempotent(store, 'asset.class.create', command.idempotencyKey, (id) => store.assetClasses.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.assetClasses.has(id)) throw new FinanceValidationError('Asset class id already exists')
    if (command.expectedVersion !== 0) throw new FinanceValidationError('expectedVersion must be 0 on create')

    const code = requiredText(command.code, 'code').toUpperCase()
    claim(store, `asset-class-code:${scope.orgId}:${scope.bookId}:${code}`, 'Asset class code already claimed in book')

    const residual = assertNonNegativeMinor(command.defaultResidualMinor ?? 0, 'defaultResidualMinor')
    const now = this.now()
    const record: AssetClass = {
      id,
      schemaVersion: 1,
      version: 1,
      ...scope,
      code,
      name: requiredText(command.name, 'name'),
      depreciationMethod: 'straight_line',
      usefulLifeMonths: assertUsefulLifeMonths(command.usefulLifeMonths),
      defaultResidualMinor: residual,
      assetAccountId: requiredText(command.assetAccountId, 'assetAccountId'),
      accumulatedDepAccountId: requiredText(command.accumulatedDepAccountId, 'accumulatedDepAccountId'),
      expenseAccountId: requiredText(command.expenseAccountId, 'expenseAccountId'),
      active: command.active !== false,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    store.assetClasses.set(id, record)
    rememberIdempotent(store, 'asset.class.create', command.idempotencyKey, id)
    await this.save(await this.load(), store)
    return record
  }

  async createFixedAsset(actor: FinanceActorContext, command: CreateFixedAssetCommand): Promise<FixedAsset> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.create', this.now())
    const store = cloneAssetsStore(await this.load())
    const idem = replayIdempotent(store, 'asset.create', command.idempotencyKey, (id) => store.assets.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.assets.has(id)) throw new FinanceValidationError('Fixed asset id already exists')
    if (command.expectedVersion !== 0) throw new FinanceValidationError('expectedVersion must be 0 on create')

    const assetClass = store.assetClasses.get(requiredText(command.assetClassId, 'assetClassId'))
    if (!assetClass) throw new AssetsFinanceNotFoundError('Asset class not found')
    assertExactScope(assetClass, scope, 'Asset class')
    if (!assetClass.active) throw new FinanceValidationError('Asset class is inactive')

    const assetNumber = requiredText(command.assetNumber, 'assetNumber')
    claim(store, `asset-number:${scope.orgId}:${scope.bookId}:${assetNumber}`, 'Asset number already claimed in book')

    const costMinor = assertPositiveMinor(command.costMinor, 'costMinor')
    const residualValueMinor = assertNonNegativeMinor(
      command.residualValueMinor ?? assetClass.defaultResidualMinor,
      'residualValueMinor',
    )
    if (residualValueMinor > costMinor) throw new FinanceValidationError('residualValueMinor cannot exceed costMinor')
    const usefulLifeMonths = assertUsefulLifeMonths(command.usefulLifeMonths ?? assetClass.usefulLifeMonths)
    parseCanonicalDate(command.acquisitionDate, 'acquisitionDate')
    parseCanonicalDate(command.inServiceDate, 'inServiceDate')
    if (comparePeriodKeys(periodKeyFromDate(command.inServiceDate), periodKeyFromDate(command.acquisitionDate)) < 0) {
      throw new FinanceValidationError('inServiceDate cannot be before acquisitionDate month')
    }

    const now = this.now()
    const record: FixedAsset = {
      id,
      schemaVersion: 1,
      version: 1,
      ...scope,
      assetNumber,
      name: requiredText(command.name, 'name'),
      ...(command.description ? { description: command.description.trim() } : {}),
      assetClassId: assetClass.id,
      currency: requiredText(command.currency, 'currency').toUpperCase(),
      costMinor,
      residualValueMinor,
      usefulLifeMonths,
      depreciationMethod: 'straight_line',
      acquisitionDate: command.acquisitionDate,
      inServiceDate: command.inServiceDate,
      status: 'draft',
      accumulatedDepreciationMinor: 0,
      netBookValueMinor: costMinor,
      assetAccountId: assetClass.assetAccountId,
      accumulatedDepAccountId: assetClass.accumulatedDepAccountId,
      expenseAccountId: assetClass.expenseAccountId,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    // Validate schedule is constructible.
    buildStraightLineSchedule(record)
    store.assets.set(id, record)
    rememberIdempotent(store, 'asset.create', command.idempotencyKey, id)
    await this.save(await this.load(), store)
    return record
  }

  async activateFixedAsset(actor: FinanceActorContext, command: ActivateFixedAssetCommand): Promise<FixedAsset> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.activate', this.now())
    const store = cloneAssetsStore(await this.load())
    const idem = replayIdempotent(store, 'asset.activate', command.idempotencyKey, (id) => store.assets.get(id))
    if (idem) return idem

    const asset = store.assets.get(requiredText(command.id, 'id'))
    if (!asset) throw new AssetsFinanceNotFoundError('Fixed asset not found')
    assertExactScope(asset, scope, 'Fixed asset')
    if (asset.version !== command.expectedVersion) {
      throw new FinanceValidationError('Fixed asset version conflict')
    }
    if (asset.status !== 'draft') throw new FinanceValidationError('Only draft assets can be activated')

    const now = this.now()
    const next: FixedAsset = {
      ...asset,
      status: 'active',
      version: asset.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    store.assets.set(next.id, next)
    rememberIdempotent(store, 'asset.activate', command.idempotencyKey, next.id)
    await this.save(await this.load(), store)
    return next
  }

  async createDepreciationRun(actor: FinanceActorContext, command: CreateDepreciationRunCommand): Promise<DepreciationRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.depreciation.run.create', this.now())
    const store = cloneAssetsStore(await this.load())
    const idem = replayIdempotent(store, 'depreciation.run.create', command.idempotencyKey, (id) => store.depreciationRuns.get(id))
    if (idem) return idem

    const id = requiredText(command.id, 'id')
    if (store.depreciationRuns.has(id)) throw new FinanceValidationError('Depreciation run id already exists')
    if (command.expectedVersion !== 0) throw new FinanceValidationError('expectedVersion must be 0 on create')

    const period = parsePeriodKey(command.periodKey)
    claim(store, `depreciation-run-period:${scope.orgId}:${scope.bookId}:${period.key}`, 'A depreciation run already exists for this period')
    parseCanonicalDate(command.postingDate, 'postingDate')

    const now = this.now()
    const record: DepreciationRun = {
      id,
      schemaVersion: 1,
      version: 1,
      ...scope,
      periodKey: period.key,
      ...(command.periodId ? { periodId: command.periodId } : {}),
      postingDate: command.postingDate,
      status: 'draft',
      description: command.description?.trim() || `Depreciation ${period.key}`,
      itemCount: 0,
      totalDepreciationMinor: 0,
      items: [],
      inputDigest: digest([scope, period.key, command.postingDate]),
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    store.depreciationRuns.set(id, record)
    rememberIdempotent(store, 'depreciation.run.create', command.idempotencyKey, id)
    await this.save(await this.load(), store)
    return record
  }

  async calculateDepreciationRun(actor: FinanceActorContext, command: CalculateDepreciationRunCommand): Promise<DepreciationRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.depreciation.run.calculate', this.now())
    const store = cloneAssetsStore(await this.load())
    const idem = replayIdempotent(store, 'depreciation.run.calculate', command.idempotencyKey, (id) => store.depreciationRuns.get(id))
    if (idem) return idem

    const run = store.depreciationRuns.get(requiredText(command.id, 'id'))
    if (!run) throw new AssetsFinanceNotFoundError('Depreciation run not found')
    assertExactScope(run, scope, 'Depreciation run')
    if (run.version !== command.expectedVersion) throw new FinanceValidationError('Depreciation run version conflict')
    if (run.status !== 'draft' && run.status !== 'calculated') {
      throw new FinanceValidationError('Only draft or calculated runs can be recalculated')
    }
    if (run.status === 'approved_posted') {
      throw new FinanceValidationError('Posted depreciation runs are immutable')
    }

    const items: DepreciationRunItem[] = []
    let total = 0
    const candidates = [...store.assets.values()]
      .filter((asset) => asset.orgId === scope.orgId && asset.legalEntityId === scope.legalEntityId && asset.bookId === scope.bookId)
      .sort((a, b) => a.assetNumber.localeCompare(b.assetNumber))

    for (const asset of candidates) {
      if (asset.status !== 'active') continue
      try {
        assertAssetActiveForDepreciation(asset, run.periodKey)
      } catch {
        continue
      }
      const line = scheduleLineForPeriod(asset, run.periodKey)
      if (!line || line.amountMinor <= 0) {
        // Still allow zero-amount final residual-only assets to mark progress when amount is 0 and base was 0.
        if (!line) continue
      }
      const amountMinor = line.amountMinor
      if (asset.accumulatedDepreciationMinor + amountMinor > depreciableCap(asset)) {
        throw new FinanceValidationError(`Depreciation would exceed depreciable base for asset ${asset.assetNumber}`)
      }
      const openingAccumulatedMinor = asset.accumulatedDepreciationMinor
      const closingAccumulatedMinor = openingAccumulatedMinor + amountMinor
      const openingNbvMinor = asset.netBookValueMinor
      const closingNbvMinor = netBookValueMinor(asset.costMinor, closingAccumulatedMinor)
      if (closingNbvMinor < asset.residualValueMinor) {
        throw new FinanceValidationError(`Depreciation would breach residual value for asset ${asset.assetNumber}`)
      }
      items.push({
        id: `${run.id}_${asset.id}`,
        depreciationRunId: run.id,
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        assetName: asset.name,
        periodIndex: line.periodIndex,
        amountMinor,
        openingAccumulatedMinor,
        closingAccumulatedMinor,
        openingNbvMinor,
        closingNbvMinor,
        expenseAccountId: asset.expenseAccountId,
        accumulatedDepAccountId: asset.accumulatedDepAccountId,
      })
      total += amountMinor
    }

    const now = this.now()
    const next: DepreciationRun = {
      ...run,
      status: 'calculated',
      items,
      itemCount: items.length,
      totalDepreciationMinor: total,
      calculatedAt: now,
      calculatedBy: actor.uid,
      inputDigest: digest([run.periodKey, items.map((i) => [i.assetId, i.amountMinor, i.periodIndex])]),
      version: run.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    }
    store.depreciationRuns.set(next.id, next)
    rememberIdempotent(store, 'depreciation.run.calculate', command.idempotencyKey, next.id)
    await this.save(await this.load(), store)
    return next
  }

  async postDepreciationRun(actor: FinanceActorContext, command: PostDepreciationRunCommand): Promise<DepreciationRun> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.depreciation.run.post', this.now())
    const store = cloneAssetsStore(await this.load())
    const idem = replayIdempotent(store, 'depreciation.run.post', command.idempotencyKey, (id) => store.depreciationRuns.get(id))
    if (idem) return idem

    const run = store.depreciationRuns.get(requiredText(command.id, 'id'))
    if (!run) throw new AssetsFinanceNotFoundError('Depreciation run not found')
    assertExactScope(run, scope, 'Depreciation run')
    if (run.version !== command.expectedVersion) throw new FinanceValidationError('Depreciation run version conflict')
    if (run.status !== 'calculated') throw new FinanceValidationError('Depreciation run must be calculated before post')
    if (run.calculatedBy && run.calculatedBy === actor.uid && actor.membershipRole !== 'owner') {
      // Soft SOD: calculator cannot post unless org owner.
      const isAdmin = actor.membershipRole === 'admin'
      if (!isAdmin) {
        // allow finance_admin different from calculator; block same actor non-owner/admin
        throw new FinanceValidationError('Separation of duties: calculator cannot post depreciation run')
      }
    }
    requiredText(command.approvalId, 'approvalId')
    requiredText(command.reason, 'reason')

    const journalEntryId = command.journalEntryId?.trim() || `jnl_depr_${run.id}`
    const postedJournal = await this.postDepreciationJournal({
      actor,
      run,
      journalEntryId,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
    })

    const now = this.now()
    for (const item of run.items) {
      const asset = store.assets.get(item.assetId)
      if (!asset) throw new AssetsFinanceNotFoundError(`Fixed asset ${item.assetId} not found`)
      assertExactScope(asset, scope, 'Fixed asset')
      assertAssetActiveForDepreciation(asset, run.periodKey)
      if (asset.accumulatedDepreciationMinor !== item.openingAccumulatedMinor) {
        throw new FinanceValidationError(`Asset ${asset.assetNumber} accumulated depreciation changed since calculate`)
      }
      const closingAccum = item.closingAccumulatedMinor
      const closingNbv = netBookValueMinor(asset.costMinor, closingAccum)
      const fully = closingNbv === asset.residualValueMinor || closingAccum === depreciableCap(asset)
      const nextAsset: FixedAsset = {
        ...asset,
        accumulatedDepreciationMinor: closingAccum,
        netBookValueMinor: closingNbv,
        lastDepreciationPeriodKey: run.periodKey,
        status: fully ? 'fully_depreciated' : 'active',
        version: asset.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.assets.set(nextAsset.id, nextAsset)
    }

    const next: DepreciationRun = {
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
    }
    store.depreciationRuns.set(next.id, next)
    rememberIdempotent(store, 'depreciation.run.post', command.idempotencyKey, next.id)
    await this.save(await this.load(), store)
    return next
  }

  async disposeFixedAsset(actor: FinanceActorContext, command: DisposeFixedAssetCommand): Promise<{ disposal: AssetDisposal; asset: FixedAsset }> {
    const scope = requireScope(command)
    authorizeFinanceAction(actor, scope, 'asset.dispose', this.now())
    const store = cloneAssetsStore(await this.load())
    const idemKey = command.idempotencyKey
    const existing = store.idempotency.get(idemKey)
    if (existing) {
      if (existing.operation !== 'asset.dispose') throw new FinanceValidationError('Idempotency key already used for a different operation')
      const disposal = store.disposals.get(existing.resultId)
      if (!disposal) throw new FinanceValidationError('Idempotent disposal missing')
      const asset = store.assets.get(disposal.assetId)
      if (!asset) throw new FinanceValidationError('Idempotent disposed asset missing')
      return { disposal, asset }
    }

    const disposalId = requiredText(command.id, 'id')
    if (store.disposals.has(disposalId)) throw new FinanceValidationError('Disposal id already exists')
    if (command.expectedVersion !== 0) throw new FinanceValidationError('expectedVersion must be 0 on dispose create/post')

    const asset = store.assets.get(requiredText(command.assetId, 'assetId'))
    if (!asset) throw new AssetsFinanceNotFoundError('Fixed asset not found')
    assertExactScope(asset, scope, 'Fixed asset')
    if (asset.status !== 'active' && asset.status !== 'fully_depreciated') {
      throw new FinanceValidationError('Only active or fully depreciated assets can be disposed')
    }

    parseCanonicalDate(command.disposedAt, 'disposedAt')
    const proceedsMinor = assertNonNegativeMinor(command.proceedsMinor, 'proceedsMinor')
    const nbv = asset.netBookValueMinor
    const gainLossMinor = computeDisposalGainLoss({ proceedsMinor, nbvAtDisposalMinor: nbv })
    requiredText(command.approvalId, 'approvalId')
    requiredText(command.reason, 'reason')

    const now = this.now()
    let disposal: AssetDisposal = {
      id: disposalId,
      schemaVersion: 1,
      version: 1,
      ...scope,
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      disposedAt: command.disposedAt,
      proceedsMinor,
      costMinor: asset.costMinor,
      accumulatedDepreciationMinor: asset.accumulatedDepreciationMinor,
      nbvAtDisposalMinor: nbv,
      gainLossMinor,
      status: 'draft',
      proceedsAccountId: requiredText(command.proceedsAccountId, 'proceedsAccountId'),
      gainLossAccountId: requiredText(command.gainLossAccountId, 'gainLossAccountId'),
      ...(command.description ? { description: command.description.trim() } : {}),
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }

    const journalEntryId = command.journalEntryId?.trim() || `jnl_disp_${disposalId}`
    const posted = await this.postDisposalJournal({
      actor,
      disposal,
      asset,
      journalEntryId,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
    })

    disposal = {
      ...disposal,
      status: 'posted',
      journalEntryId: posted.id,
      approvalId: command.approvalId,
      approvalActorId: actor.uid,
      approvedAt: now,
      postedAt: now,
      postedBy: actor.uid,
      version: 2,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    }

    const nextAsset: FixedAsset = {
      ...asset,
      status: 'disposed',
      disposalId: disposal.id,
      disposedAt: disposal.disposedAt,
      accumulatedDepreciationMinor: asset.accumulatedDepreciationMinor,
      netBookValueMinor: 0,
      version: asset.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    }

    claim(store, `asset-disposal:${scope.orgId}:${scope.bookId}:${asset.id}`, 'Asset already has a disposal claim')
    store.disposals.set(disposal.id, disposal)
    store.assets.set(nextAsset.id, nextAsset)
    rememberIdempotent(store, 'asset.dispose', command.idempotencyKey, disposal.id)
    await this.save(await this.load(), store)
    return { disposal, asset: nextAsset }
  }

  async getBundle(actor: FinanceActorContext, scope: Required<FinanceScope>): Promise<{
    assetClasses: AssetClass[]
    assets: FixedAsset[]
    depreciationRuns: DepreciationRun[]
    disposals: AssetDisposal[]
  }> {
    authorizeFinanceAction(actor, scope, 'asset.read', this.now())
    const store = await this.load()
    const inScope = <T extends Required<FinanceScope>>(row: T) =>
      row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId
    return {
      assetClasses: [...store.assetClasses.values()].filter(inScope).sort((a, b) => a.code.localeCompare(b.code)),
      assets: [...store.assets.values()].filter(inScope).sort((a, b) => a.assetNumber.localeCompare(b.assetNumber)),
      depreciationRuns: [...store.depreciationRuns.values()].filter(inScope).sort((a, b) => a.periodKey.localeCompare(b.periodKey)),
      disposals: [...store.disposals.values()].filter(inScope).sort((a, b) => a.disposedAt.localeCompare(b.disposedAt)),
    }
  }

  async buildRegisterReport(actor: FinanceActorContext, scope: Required<FinanceScope>, asOfDate: string): Promise<FixedAssetRegisterReport> {
    authorizeFinanceAction(actor, scope, 'asset.report.read', this.now())
    parseCanonicalDate(asOfDate, 'asOfDate')
    const bundle = await this.getBundle(actor, scope)
    const lines = bundle.assets.map((asset) => ({
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      name: asset.name,
      assetClassId: asset.assetClassId,
      status: asset.status,
      costMinor: asset.costMinor,
      residualValueMinor: asset.residualValueMinor,
      accumulatedDepreciationMinor: asset.accumulatedDepreciationMinor,
      netBookValueMinor: asset.netBookValueMinor,
      inServiceDate: asset.inServiceDate,
      usefulLifeMonths: asset.usefulLifeMonths,
      ...(asset.lastDepreciationPeriodKey ? { lastDepreciationPeriodKey: asset.lastDepreciationPeriodKey } : {}),
      ...(asset.disposedAt ? { disposedAt: asset.disposedAt } : {}),
    }))
    const currency = bundle.assets[0]?.currency || 'ZAR'
    return {
      ...scope,
      asOfDate,
      currency,
      generatedAt: this.now(),
      assetCount: lines.length,
      totalCostMinor: lines.reduce((s, l) => s + l.costMinor, 0),
      totalAccumulatedMinor: lines.reduce((s, l) => s + l.accumulatedDepreciationMinor, 0),
      totalNbvMinor: lines.reduce((s, l) => s + l.netBookValueMinor, 0),
      lines,
    }
  }

  async buildDepreciationRunReport(actor: FinanceActorContext, scope: Required<FinanceScope>, runId: string): Promise<DepreciationRunReport> {
    authorizeFinanceAction(actor, scope, 'asset.report.read', this.now())
    const store = await this.load()
    const run = store.depreciationRuns.get(requiredText(runId, 'runId'))
    if (!run) throw new AssetsFinanceNotFoundError('Depreciation run not found')
    assertExactScope(run, scope, 'Depreciation run')
    return {
      ...scope,
      periodKey: run.periodKey,
      runId: run.id,
      status: run.status,
      totalDepreciationMinor: run.totalDepreciationMinor,
      itemCount: run.itemCount,
      ...(run.journalEntryId ? { journalEntryId: run.journalEntryId } : {}),
      items: run.items.map((item) => ({
        assetId: item.assetId,
        assetNumber: item.assetNumber,
        assetName: item.assetName,
        amountMinor: item.amountMinor,
        closingNbvMinor: item.closingNbvMinor,
      })),
    }
  }
}

function depreciableCap(asset: Pick<FixedAsset, 'costMinor' | 'residualValueMinor'>): number {
  return asset.costMinor - asset.residualValueMinor
}

/** In-memory helper for unit/integration tests without load/save plumbing. */
export class InMemoryAssetsFinanceService extends AssetsFinanceService {
  readonly storeRef: { current: AssetsFinanceStore }

  constructor(
    store: AssetsFinanceStore = createEmptyAssetsStore(),
    now: () => string = () => '2026-08-02T12:00:00.000Z',
    postDepreciationJournal?: DepreciationJournalPoster,
    postDisposalJournal?: DisposalJournalPoster,
  ) {
    const storeRef = { current: store }
    super(
      async () => cloneAssetsStore(storeRef.current),
      async (_before, after) => {
        storeRef.current = cloneAssetsStore(after)
      },
      postDepreciationJournal,
      postDisposalJournal,
      now,
    )
    this.storeRef = storeRef
  }
}
