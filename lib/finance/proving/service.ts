import {
  FinanceFoundationService,
  financeApprovalSubjectDigest,
  InMemoryFinanceFoundationStore,
} from '@/lib/accounting/foundation-service'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import {
  ALL_PACKAGING_KINDS,
  PackagingFinanceService,
  buildPackFiles,
  createEmptyPackagingStore,
  familyForKind,
  type PackagingFinanceStore,
} from '@/lib/finance/packaging/service'
import type { PackagingKind } from '@/lib/finance/packaging/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  COA_TEMPLATE,
  PROVING_COMPANY_NAME,
  PROVING_PERIODS,
  PROVING_SEED_KEY,
  buildAcceptanceChecklist,
  buildDemoArAp,
  buildDemoAssets,
  buildDemoBankLines,
  buildDemoEntities,
  buildDemoFx,
  buildDemoJobCosts,
  buildDemoPayroll,
  defaultCloseBlockers,
  freezeTrialBalance,
  periodBounds,
  sha256Hex,
} from './demo-blueprint'
import type {
  AcceptanceCheckItem,
  PackagingDryRunResult,
  ProvingCloseRun,
  ProvingFinanceAction,
  ProvingPeriodKey,
  ProvingSeedSnapshot,
  ProvingWorkspace,
} from './types'

export class ProvingFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'ProvingFinanceValidationError'
  }
}

export class ProvingFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'ProvingFinanceNotFoundError'
  }
}

export type ProvingStore = {
  workspaces: Map<string, ProvingWorkspace>
  claims: Set<string>
  foundationByOrg: Map<string, InMemoryFinanceFoundationStore>
}

export function createEmptyProvingStore(): ProvingStore {
  return {
    workspaces: new Map(),
    claims: new Set(),
    foundationByOrg: new Map(),
  }
}

export function cloneProvingStore(store: ProvingStore): ProvingStore {
  return {
    workspaces: new Map(
      Array.from(store.workspaces.entries(), ([k, v]) => [k, structuredClone(v)]),
    ),
    claims: new Set(store.claims),
    foundationByOrg: new Map(store.foundationByOrg),
  }
}

function emptyWorkspace(orgId: string): ProvingWorkspace {
  return {
    orgId,
    closeRuns: [],
    packagingDryRuns: [],
    acceptanceChecklist: buildAcceptanceChecklist(),
    audit: [],
  }
}

function hasWriteRole(actor: FinanceActorContext, orgId: string): boolean {
  if (actor.membershipRole === 'owner' || actor.membershipRole === 'admin') return true
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      (a.role === 'finance_admin' || a.role === 'finance_approver' || a.role === 'accountant'),
  )
}

function hasReadRole(actor: FinanceActorContext, orgId: string): boolean {
  if (hasWriteRole(actor, orgId)) return true
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      ['finance_viewer', 'bookkeeper', 'auditor', 'payroll_clerk', 'payroll_approver'].includes(a.role),
  )
}

export function authorizeProvingAction(
  actor: FinanceActorContext,
  orgId: string,
  action: ProvingFinanceAction,
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const write = action !== 'proving.read' && action !== 'proving.checklist.read'
  if (write && !hasWriteRole(actor, orgId)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (!write && !hasReadRole(actor, orgId)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.includes(`finance:${action}`) ||
      scopes.includes('finance:proving:*') ||
      scopes.some((s) => s.startsWith('finance:'))
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant finance proving access')
  }
}

function req(key: string) {
  return { requestId: `prv-req-${key}`, idempotencyKey: `prv-idem-${key}` }
}

function actorWithEntity(
  base: FinanceActorContext,
  legalEntityId: string,
  role: 'finance_admin' | 'finance_approver' = 'finance_admin',
): FinanceActorContext {
  return {
    ...base,
    assignments: [
      {
        id: `asg-${base.uid}-${legalEntityId}-${role}`,
        orgId: base.orgId,
        userId: base.uid,
        legalEntityId,
        scopeMode: 'entity',
        role,
        status: 'active',
      },
    ],
  }
}

function snapshotDigest(seed: ProvingSeedSnapshot): string {
  const { seededAt, seededBy, ...stable } = seed
  return sha256Hex(JSON.stringify(stable))
}

export function seedSnapshotDigest(seed: ProvingSeedSnapshot): string {
  return snapshotDigest(seed)
}

export type SeedProvingCommand = {
  orgId: string
  seedKey?: string
  requestId: string
  idempotencyKey: string
}

export type RunCloseFixtureCommand = {
  orgId: string
  entityCode?: string
  periodKey?: ProvingPeriodKey
  resolveBlockers?: boolean
  requestId: string
  idempotencyKey: string
}

export type PackagingDryRunCommand = {
  orgId: string
  requestId: string
  idempotencyKey: string
}

export type ToggleChecklistCommand = {
  orgId: string
  itemId: string
  checked: boolean
  requestId: string
  idempotencyKey: string
}

export class FinanceProvingService {
  constructor(
    private readonly load: () => Promise<ProvingStore>,
    private readonly save: (before: ProvingStore, after: ProvingStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getBundle(actor: FinanceActorContext, orgId: string) {
    authorizeProvingAction(actor, orgId, 'proving.read')
    const store = await this.load()
    const ws = store.workspaces.get(orgId) ?? emptyWorkspace(orgId)
    return {
      workspace: ws,
      seedDigest: ws.seed ? seedSnapshotDigest(ws.seed) : null,
      hardGates: {
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
        externalEgressAllowed: false as const,
        massEmailAllowed: false as const,
      },
      printReady: true,
    }
  }

  async seedDemoCompany(actor: FinanceActorContext, command: SeedProvingCommand) {
    authorizeProvingAction(actor, command.orgId, 'proving.seed')
    const orgId = command.orgId
    const seedKey = command.seedKey?.trim() || PROVING_SEED_KEY
    const before = await this.load()
    const claim = `proving_idem:${orgId}:${command.idempotencyKey}`
    if (before.claims.has(claim)) {
      const existing = before.workspaces.get(orgId)?.seed
      if (!existing) throw new ProvingFinanceValidationError('Idempotency claim present without seed')
      return { seed: existing, idempotentReplay: true, digest: seedSnapshotDigest(existing) }
    }

    const existingSeed = before.workspaces.get(orgId)?.seed
    if (existingSeed && existingSeed.seedKey === seedKey) {
      const after = cloneProvingStore(before)
      after.claims.add(claim)
      const ws = after.workspaces.get(orgId) ?? emptyWorkspace(orgId)
      ws.audit.push({
        at: this.now(),
        action: 'proving.seed',
        actorId: actor.uid,
        summary: 'Idempotent seed replay (same seedKey)',
        externalEgressAllowed: false,
      })
      after.workspaces.set(orgId, ws)
      await this.save(before, after)
      return { seed: existingSeed, idempotentReplay: true, digest: seedSnapshotDigest(existingSeed) }
    }

    const foundation = new InMemoryFinanceFoundationStore()
    const foundationService = new FinanceFoundationService(foundation, () => this.now())
    const admin = actor
    const approverUid = `${actor.uid}-approver`
    const entities = buildDemoEntities(orgId)
    const periods: ProvingSeedSnapshot['periods'] = []
    const accountsByBook: ProvingSeedSnapshot['accountsByBook'] = {}
    const journals: ProvingSeedSnapshot['journals'] = []

    for (const entity of entities) {
      const adminScoped = actorWithEntity(admin, entity.id, 'finance_admin')
      // SOD approver must keep assignment.userId === actor.uid (policy scope match).
      const approverScoped: FinanceActorContext = {
        ...actorWithEntity({ ...admin, uid: approverUid }, entity.id, 'finance_approver'),
        membershipRole: 'admin',
      }

      await foundationService.createLegalEntity(adminScoped, {
        id: entity.id,
        orgId,
        code: entity.code,
        legalName: entity.legalName,
        jurisdictionCode: 'ZA',
        functionalCurrency: 'ZAR',
        defaultAccountingBasis: 'accrual',
        fiscalYearStartMonth: 3,
        timezone: 'Africa/Johannesburg',
        status: 'active',
        expectedVersion: 0,
        ...req(`${entity.code}-entity`),
      })

      await foundationService.createBranch(adminScoped, {
        id: entity.branchId,
        orgId,
        legalEntityId: entity.id,
        code: entity.branchCode,
        name: `${entity.code} ${entity.branchCode}`,
        status: 'active',
        reportingOnly: false,
        expectedVersion: 0,
        ...req(`${entity.code}-branch`),
      })

      const defaultControlAccountIds = {
        cash: `${entity.bookId}_acc_1000`,
        receivables: `${entity.bookId}_acc_1100`,
        payables: `${entity.bookId}_acc_2000`,
        tax: `${entity.bookId}_acc_2100`,
        retainedEarnings: `${entity.bookId}_acc_3100`,
      }

      await foundationService.createBook(adminScoped, {
        id: entity.bookId,
        orgId,
        legalEntityId: entity.id,
        code: entity.bookCode,
        name: `${entity.code} Primary`,
        bookType: 'primary',
        functionalCurrency: 'ZAR',
        accountingBasis: 'accrual',
        jurisdictionCode: 'ZA',
        taxPointPolicyId: 'za-invoice',
        defaultControlAccountIds,
        status: 'active',
        cutoverAt: '2026-05-01',
        expectedVersion: 0,
        ...req(`${entity.code}-book`),
      })

      const policyCommand = {
        id: `${entity.bookId}_policy_v1`,
        orgId,
        legalEntityId: entity.id,
        bookId: entity.bookId,
        versionNumber: 1,
        accountingBasis: 'accrual' as const,
        taxPointPolicyId: 'za-invoice',
        currencyPrecision: 2,
        roundingMode: 'half_up' as const,
        effectiveFrom: '2026-05-01',
        expectedVersion: 0 as const,
        ...req(`${entity.code}-policy`),
      }
      await foundationService.createFinanceApproval(approverScoped, {
        id: `${entity.bookId}_pol_appr`,
        orgId,
        legalEntityId: entity.id,
        bookId: entity.bookId,
        action: 'book-policy.approve',
        subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policyCommand),
        reason: 'Proving kit policy',
        expectedVersion: 0,
        ...req(`${entity.code}-pol-appr`),
      })
      await foundationService.createBookPolicyVersion(adminScoped, {
        ...policyCommand,
        approvalId: `${entity.bookId}_pol_appr`,
      })

      accountsByBook[entity.bookId] = []
      for (const acct of COA_TEMPLATE) {
        const accountId = `${entity.bookId}_acc_${acct.code}`
        await foundationService.createAccount(adminScoped, {
          id: accountId,
          orgId,
          legalEntityId: entity.id,
          bookId: entity.bookId,
          code: acct.code,
          name: acct.name,
          accountType: acct.accountType,
          normalBalance: acct.normalBalance,
          controlAccountRole: acct.controlAccountRole,
          currency: 'ZAR',
          currencyPolicy: 'functional_only',
          reportMapping: acct.accountType,
          postingAllowed: true,
          activeFrom: '2026-05-01',
          expectedVersion: 0,
          ...req(`${entity.code}-acc-${acct.code}`),
        })
        accountsByBook[entity.bookId].push({
          id: accountId,
          code: acct.code,
          name: acct.name,
          accountType: acct.accountType,
        })
      }

      for (const periodKey of PROVING_PERIODS) {
        const bounds = periodBounds(periodKey)
        const periodId = `${entity.bookId}_per_${periodKey}`
        const period = await foundationService.createPeriod(adminScoped, {
          id: periodId,
          orgId,
          legalEntityId: entity.id,
          bookId: entity.bookId,
          fiscalYear: bounds.fiscalYear,
          periodNumber: bounds.periodNumber,
          startsAt: bounds.startsAt,
          endsAt: bounds.endsAt,
          status: 'open',
          expectedVersion: 0,
          ...req(`${entity.code}-per-${periodKey}`),
        })
        periods.push({
          id: period.id,
          entityId: entity.id,
          bookId: entity.bookId,
          periodKey,
          status: period.status,
          version: period.version,
        })
      }

      // Opening capital + activity journals for May/June/July
      const activity: Array<{ periodKey: ProvingPeriodKey; amount: number; desc: string }> = [
        { periodKey: '2026-05', amount: 100_000_00, desc: 'Opening capitalisation' },
        { periodKey: '2026-06', amount: 25_000_00, desc: 'June revenue recognition' },
        { periodKey: '2026-07', amount: 40_000_00, desc: 'July revenue recognition' },
      ]
      for (const act of activity) {
        const periodId = `${entity.bookId}_per_${act.periodKey}`
        const journalId = `${entity.bookId}_jnl_${act.periodKey}`
        const isOpening = act.periodKey === '2026-05'
        const lines = isOpening
          ? [
              { accountId: `${entity.bookId}_acc_1500`, debitMinor: act.amount, creditMinor: 0 },
              { accountId: `${entity.bookId}_acc_3000`, debitMinor: 0, creditMinor: act.amount },
            ]
          : [
              { accountId: `${entity.bookId}_acc_1200`, debitMinor: act.amount, creditMinor: 0 },
              { accountId: `${entity.bookId}_acc_4000`, debitMinor: 0, creditMinor: act.amount },
            ]
        const journalCmd = {
          id: journalId,
          orgId,
          legalEntityId: entity.id,
          bookId: entity.bookId,
          periodId,
          sourceType: isOpening ? ('opening_balance' as const) : ('manual' as const),
          sourceId: `${entity.code}-${act.periodKey}`,
          sourceVersion: 1,
          postingPurpose: isOpening ? 'opening_balance' : 'manual_adjustment',
          entryType: isOpening ? ('opening' as const) : ('standard' as const),
          postingDate: periodBounds(act.periodKey).startsAt,
          documentDate: periodBounds(act.periodKey).startsAt,
          description: act.desc,
          currency: 'ZAR',
          policyVersionId: `${entity.bookId}_policy_v1`,
          expectedVersion: 0 as const,
          ...req(`${entity.code}-jnl-${act.periodKey}`),
          approvalId: `${journalId}_appr`,
          lines,
        }
        await foundationService.createFinanceApproval(approverScoped, {
          id: `${journalId}_appr`,
          orgId,
          legalEntityId: entity.id,
          bookId: entity.bookId,
          action: 'journal.post',
          subjectDigest: financeApprovalSubjectDigest('journal.post', journalCmd),
          reason: 'Proving kit activity',
          expectedVersion: 0,
          ...req(`${entity.code}-jnl-appr-${act.periodKey}`),
        })
        const posted = await foundationService.postJournal(adminScoped, journalCmd)
        journals.push({
          id: posted.id,
          entityId: entity.id,
          bookId: entity.bookId,
          periodId,
          periodKey: act.periodKey,
          description: act.desc,
          debitMinor: posted.totalDebitMinor,
          creditMinor: posted.totalCreditMinor,
          contentHash: posted.contentHash,
        })
      }
    }

    const seed: ProvingSeedSnapshot = {
      schemaVersion: 1,
      seedKey,
      orgId,
      companyName: PROVING_COMPANY_NAME,
      seededAt: this.now(),
      seededBy: actor.uid,
      entities,
      periods,
      accountsByBook,
      journals,
      arAp: buildDemoArAp(entities),
      bankLines: buildDemoBankLines(entities),
      payrollRuns: buildDemoPayroll(entities),
      fxPositions: buildDemoFx(entities),
      assets: buildDemoAssets(entities),
      jobCosts: buildDemoJobCosts(entities),
      hardGates: {
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        massEmailAllowed: false,
      },
    }

    const after = cloneProvingStore(before)
    after.claims.add(claim)
    after.foundationByOrg.set(orgId, foundation)
    const ws = after.workspaces.get(orgId) ?? emptyWorkspace(orgId)
    ws.seed = seed
    if (ws.acceptanceChecklist.length === 0) ws.acceptanceChecklist = buildAcceptanceChecklist()
    ws.audit.push({
      at: this.now(),
      action: 'proving.seed',
      actorId: actor.uid,
      summary: `Seeded ${entities.length} entities / ${journals.length} journals`,
      externalEgressAllowed: false,
    })
    after.workspaces.set(orgId, ws)
    await this.save(before, after)
    return { seed, idempotentReplay: false, digest: seedSnapshotDigest(seed) }
  }

  async runCloseFixture(actor: FinanceActorContext, command: RunCloseFixtureCommand) {
    authorizeProvingAction(actor, command.orgId, 'proving.close_fixture.run')
    const before = await this.load()
    const claim = `proving_idem:${command.orgId}:${command.idempotencyKey}`
    if (before.claims.has(claim)) {
      const run = before.workspaces.get(command.orgId)?.closeRuns.at(-1)
      if (!run) throw new ProvingFinanceValidationError('Idempotency claim present without close run')
      return { closeRun: run, idempotentReplay: true }
    }

    const ws = before.workspaces.get(command.orgId)
    if (!ws?.seed) throw new ProvingFinanceValidationError('Seed demo company before running close fixture')
    const seed = structuredClone(ws.seed)
    const entityCode = command.entityCode ?? 'OPS'
    const entity = seed.entities.find((e) => e.code === entityCode)
    if (!entity) throw new ProvingFinanceValidationError(`Unknown entity code ${entityCode}`)
    const periodKey = command.periodKey ?? '2026-07'
    const period = seed.periods.find((p) => p.entityId === entity.id && p.periodKey === periodKey)
    if (!period) throw new ProvingFinanceValidationError('Period not found on seed')

    let bankLines = seed.bankLines
    let payrollRuns = seed.payrollRuns
    let fxPositions = seed.fxPositions
    let assets = seed.assets
    let cutoverComplete = true

    if (command.resolveBlockers) {
      bankLines = bankLines.map((b) =>
        b.entityId === entity.id ? { ...b, matched: true } : b,
      )
      payrollRuns = payrollRuns.map((p) =>
        p.entityId === entity.id && p.periodKey === periodKey
          ? { ...p, status: 'approved_locked' as const }
          : p,
      )
      fxPositions = fxPositions.map((f) =>
        f.entityId === entity.id ? { ...f, revaluationOpen: false } : f,
      )
      assets = assets.map((a) =>
        a.entityId === entity.id ? { ...a, depreciationPostedThrough: periodKey } : a,
      )
      cutoverComplete = true
    }

    const blockers = defaultCloseBlockers({
      bankLines,
      payrollRuns,
      fxPositions,
      assets,
      periodKey,
      entityId: entity.id,
      cutoverComplete,
    })
    const unresolved = blockers.filter((b) => !b.resolved)
    const now = this.now()
    const closeRun: ProvingCloseRun = {
      id: `close_${entity.code}_${periodKey}_${sha256Hex(command.idempotencyKey).slice(0, 8)}`,
      orgId: command.orgId,
      seedKey: seed.seedKey,
      entityId: entity.id,
      bookId: entity.bookId,
      periodKey,
      status: unresolved.length ? 'blocked' : 'closed',
      blockers,
      createdAt: now,
      updatedAt: now,
    }

    const foundation = before.foundationByOrg.get(command.orgId)
    if (!unresolved.length && foundation) {
      const foundationService = new FinanceFoundationService(foundation, () => this.now())
      const adminScoped = actorWithEntity(actor, entity.id, 'finance_admin')
      const approverUid = `${actor.uid}-approver`
      const approverScoped: FinanceActorContext = {
        ...actorWithEntity({ ...actor, uid: approverUid }, entity.id, 'finance_approver'),
        membershipRole: 'admin',
      }
      const closeCmd = {
        orgId: command.orgId,
        legalEntityId: entity.id,
        bookId: entity.bookId,
        periodId: period.id,
        status: 'hard_closed' as const,
        expectedVersion: period.version,
        reason: 'Proving kit multi-period close',
        approvalId: `close_appr_${period.id}`,
        requestId: command.requestId,
        idempotencyKey: `close-${command.idempotencyKey}`,
      }
      await foundationService.createFinanceApproval(approverScoped, {
        id: closeCmd.approvalId,
        orgId: command.orgId,
        legalEntityId: entity.id,
        bookId: entity.bookId,
        action: 'period.close',
        subjectDigest: financeApprovalSubjectDigest('period.close', closeCmd),
        reason: 'Proving close approved',
        expectedVersion: 0,
        ...req(`close-appr-${period.id}`),
      })
      const closedPeriod = await foundationService.changePeriodStatus(adminScoped, closeCmd)
      period.status = closedPeriod.status
      period.version = closedPeriod.version

      const periodJournals = seed.journals.filter(
        (j) => j.entityId === entity.id && j.periodKey === periodKey,
      )
      const lines = [
        {
          accountCode: '1100',
          debitMinor: periodJournals.reduce((n, j) => n + j.debitMinor, 0),
          creditMinor: 0,
        },
        {
          accountCode: '4000',
          debitMinor: 0,
          creditMinor: periodJournals.reduce((n, j) => n + j.creditMinor, 0),
        },
      ]
      const freeze = freezeTrialBalance({
        periodKey,
        entityId: entity.id,
        bookId: entity.bookId,
        frozenAt: now,
        lines,
        journalCount: periodJournals.length,
      })
      closeRun.freeze = freeze
      closeRun.status = 'reports_frozen'
      closeRun.closedAt = now

      // Invariant: posting into hard-closed period must fail
      const rejectId = `${entity.bookId}_jnl_post_close_reject`
      const rejectCmd = {
        id: rejectId,
        orgId: command.orgId,
        legalEntityId: entity.id,
        bookId: entity.bookId,
        periodId: period.id,
        sourceType: 'manual' as const,
        sourceId: `post-close-${periodKey}`,
        sourceVersion: 1,
        postingPurpose: 'manual_adjustment',
        entryType: 'standard' as const,
        postingDate: periodBounds(periodKey).endsAt,
        documentDate: periodBounds(periodKey).endsAt,
        description: 'Must fail after hard close',
        currency: 'ZAR',
        policyVersionId: `${entity.bookId}_policy_v1`,
        expectedVersion: 0 as const,
        ...req(`post-close-${period.id}`),
        approvalId: `${rejectId}_appr`,
        lines: [
          { accountId: `${entity.bookId}_acc_5000`, debitMinor: 100, creditMinor: 0 },
          { accountId: `${entity.bookId}_acc_4000`, debitMinor: 0, creditMinor: 100 },
        ],
      }
      await foundationService.createFinanceApproval(approverScoped, {
        id: rejectCmd.approvalId,
        orgId: command.orgId,
        legalEntityId: entity.id,
        bookId: entity.bookId,
        action: 'journal.post',
        subjectDigest: financeApprovalSubjectDigest('journal.post', rejectCmd),
        reason: 'Attempt post-close',
        expectedVersion: 0,
        ...req(`post-close-appr-${period.id}`),
      })
      try {
        await foundationService.postJournal(adminScoped, rejectCmd)
        throw new ProvingFinanceValidationError('Expected hard-closed period to reject journal post')
      } catch (error) {
        if (error instanceof ProvingFinanceValidationError) throw error
        if (!(error instanceof FinanceValidationError) && !(error instanceof Error)) throw error
        // expected: hard closed / soft closed rejection
      }
    }

    seed.bankLines = bankLines
    seed.payrollRuns = payrollRuns
    seed.fxPositions = fxPositions
    seed.assets = assets
    seed.periods = seed.periods.map((p) =>
      p.id === period.id ? { ...p, status: period.status, version: period.version } : p,
    )

    const after = cloneProvingStore(before)
    after.claims.add(claim)
    if (foundation) after.foundationByOrg.set(command.orgId, foundation)
    const next = after.workspaces.get(command.orgId) ?? emptyWorkspace(command.orgId)
    next.seed = seed
    next.closeRuns = [...next.closeRuns, closeRun]
    next.audit.push({
      at: now,
      action: 'proving.close_fixture.run',
      actorId: actor.uid,
      summary: `Close fixture ${entity.code} ${periodKey} → ${closeRun.status}`,
      externalEgressAllowed: false,
    })
    after.workspaces.set(command.orgId, next)
    await this.save(before, after)
    return { closeRun, idempotentReplay: false }
  }

  async packagingDryRun(actor: FinanceActorContext, command: PackagingDryRunCommand) {
    authorizeProvingAction(actor, command.orgId, 'proving.packaging.dry_run')
    const before = await this.load()
    const claim = `proving_idem:${command.orgId}:${command.idempotencyKey}`
    if (before.claims.has(claim)) {
      const runs = before.workspaces.get(command.orgId)?.packagingDryRuns ?? []
      return { packs: runs, idempotentReplay: true }
    }
    const seed = before.workspaces.get(command.orgId)?.seed
    if (!seed) throw new ProvingFinanceValidationError('Seed demo company before packaging dry-run')

    const ops = seed.entities.find((e) => e.code === 'OPS') ?? seed.entities[0]
    const lockedPayroll = seed.payrollRuns.filter((p) => p.status === 'approved_locked')
    const emp201Rows = lockedPayroll.map((p) => ({
      taxPeriod: p.periodKey,
      payeMinor: p.payeMinor,
      uifMinor: p.uifMinor,
      sdlMinor: p.sdlMinor,
      totalMinor: p.payeMinor + p.uifMinor + p.sdlMinor,
      employeeCount: p.employeeCount,
      reference: `EMP201-${p.id}`,
    }))
    const eftRows = seed.arAp
      .filter((a) => a.role === 'supplier' && a.openMinor > 0)
      .map((a) => ({
        beneficiaryName: a.counterpartyName,
        bankName: 'FNB',
        accountNumber: '62800123456',
        branchCode: '250655',
        amountMinor: a.openMinor,
        currency: a.currency,
        reference: a.documentNumber,
        sourceDocumentId: a.id,
      }))
    const tbRows = (seed.accountsByBook[ops.bookId] ?? []).map((acct, idx) => ({
      accountId: acct.id,
      accountCode: acct.code,
      accountName: acct.name,
      debitMinor: idx % 2 === 0 ? 1000 : 0,
      creditMinor: idx % 2 === 1 ? 1000 : 0,
      currency: 'ZAR',
    }))
    const glRows = seed.journals
      .filter((j) => j.entityId === ops.id)
      .map((j) => ({
        journalEntryId: j.id,
        postingDate: periodBounds(j.periodKey).startsAt,
        accountId: `${ops.bookId}_acc_1000`,
        accountCode: '1000',
        debitMinor: j.debitMinor,
        creditMinor: 0,
        description: j.description,
        currency: 'ZAR',
      }))
    const openItemRows = seed.arAp.map((a) => ({
      openItemId: a.id,
      counterpartyRole: a.role,
      counterpartyCompanyId: a.counterpartyName,
      originalMinor: a.originalMinor,
      openMinor: a.openMinor,
      dueDate: a.dueDate,
      currency: a.currency,
      sourceType: a.role === 'customer' ? 'customer_invoice' : 'supplier_bill',
    }))
    const auditRows = [
      {
        eventId: 'audit_seed',
        occurredAt: seed.seededAt,
        action: 'proving.seed',
        actorId: seed.seededBy,
        resourceType: 'proving_seed',
        resourceId: seed.seedKey,
        summary: 'Demo company seeded',
      },
    ]

    const payloadByKind: Partial<Record<PackagingKind, Record<string, unknown>>> = {
      'sars.emp201': { rows: emp201Rows },
      'sars.emp501': {
        rows: [
          {
            taxYear: '2026',
            emp201TotalMinor: emp201Rows.reduce((n, r) => n + r.totalMinor, 0),
            certificateTotalMinor: emp201Rows.reduce((n, r) => n + r.totalMinor, 0),
            differenceMinor: 0,
            status: 'balanced',
            reference: 'EMP501-2026-PROVING',
          },
        ],
      },
      'sars.irp5_it3a': {
        rows: lockedPayroll.flatMap((p) =>
          Array.from({ length: Math.min(p.employeeCount, 2) }, (_, i) => ({
            certificateKind: 'IRP5',
            employeeId: `${p.entityId}_emp_${i + 1}`,
            taxYear: '2026',
            taxableIncomeMinor: Math.round(p.grossMinor / p.employeeCount),
            payeMinor: Math.round(p.payeMinor / p.employeeCount),
            uifMinor: Math.round(p.uifMinor / p.employeeCount),
            certificateNumber: `IRP5-${p.periodKey}-${i + 1}`,
          })),
        ),
      },
      'sars.vat_return': {
        rows: [],
        boxRows: [
          { boxCode: '1', label: 'Standard rated supplies', amountMinor: 10_000_000, currency: 'ZAR' },
          { boxCode: '4', label: 'Input tax', amountMinor: 1_500_000, currency: 'ZAR' },
          { boxCode: '14', label: 'VAT payable', amountMinor: 1_500_000, currency: 'ZAR' },
        ],
      },
      'payment.eft_instructions': { rows: eftRows },
      'payment.payroll_net': {
        rows: lockedPayroll.map((p) => ({
          employeeId: `${p.entityId}_batch`,
          employeeName: 'Batch net pay',
          bankName: 'Standard Bank',
          accountNumber: '001234567',
          branchCode: '051001',
          amountMinor: p.netMinor,
          netPayMinor: p.netMinor,
          currency: 'ZAR',
          payRunId: p.id,
          reference: `NET-${p.id}`,
          actionDate: '2026-07-31',
        })),
      },
      'payment.acb_ap': { rows: eftRows },
      'payment.netcash_ap': { rows: eftRows },
      'payment.acb_payroll': {
        rows: lockedPayroll.map((p) => ({
          beneficiaryName: 'Payroll batch',
          employeeId: `${p.entityId}_batch`,
          employeeName: 'Batch net pay',
          bankName: 'Standard Bank',
          accountNumber: '001234567',
          branchCode: '051001',
          amountMinor: p.netMinor,
          netPayMinor: p.netMinor,
          currency: 'ZAR',
          payRunId: p.id,
          reference: `ACB-NET-${p.id}`,
          actionDate: '2026-07-31',
        })),
      },
      'payment.netcash_payroll': {
        rows: lockedPayroll.map((p) => ({
          beneficiaryName: 'Payroll batch',
          employeeId: `${p.entityId}_batch`,
          employeeName: 'Batch net pay',
          bankName: 'Standard Bank',
          accountNumber: '001234567',
          branchCode: '051001',
          amountMinor: p.netMinor,
          netPayMinor: p.netMinor,
          currency: 'ZAR',
          payRunId: p.id,
          reference: `NC-NET-${p.id}`,
          actionDate: '2026-07-31',
        })),
      },
      'accountant.trial_balance': { rows: tbRows },
      'accountant.general_ledger': { rows: glRows },
      'accountant.open_items': { rows: openItemRows },
      'accountant.audit_extract': { rows: auditRows },
      'accountant.cutover_evidence': {
        package: {
          id: 'cutover_proving',
          status: 'activated',
          cutoverAt: '2026-05-01',
          entities: seed.entities.map((e) => e.code),
        },
      },
    }

    const packStore: PackagingFinanceStore = createEmptyPackagingStore()
    const packaging = new PackagingFinanceService(
      async () => packStore,
      async (_b, a) => {
        packStore.packs = a.packs
        packStore.claims = a.claims
      },
      () => this.now(),
    )

    const results: PackagingDryRunResult[] = []
    for (const kind of ALL_PACKAGING_KINDS) {
      const payload = payloadByKind[kind] ?? { rows: [] }
      const built = buildPackFiles(kind, payload)
      const created = await packaging.createPack(actor, {
        id: `pack_${kind.replace(/[.^]/g, '_')}_${command.idempotencyKey.slice(0, 8)}`,
        orgId: command.orgId,
        legalEntityId: ops.id,
        bookId: ops.bookId,
        kind,
        periodFrom: '2026-05-01',
        periodTo: '2026-07-31',
        payload,
        requestId: `${command.requestId}-${kind}`,
        idempotencyKey: `${command.idempotencyKey}-${kind}`,
      })
      results.push({
        kind,
        family: familyForKind(kind),
        title: created.title,
        fileNames: built.files.map((f) => f.name),
        rowCount: built.rowCount,
        sampleSha256: built.files[0]?.sha256 ?? sha256Hex(kind),
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
      })
    }

    const after = cloneProvingStore(before)
    after.claims.add(claim)
    const next = after.workspaces.get(command.orgId) ?? emptyWorkspace(command.orgId)
    next.packagingDryRuns = results
    next.audit.push({
      at: this.now(),
      action: 'proving.packaging.dry_run',
      actorId: actor.uid,
      summary: `Dry-ran ${results.length} packaging kinds`,
      externalEgressAllowed: false,
    })
    after.workspaces.set(command.orgId, next)
    await this.save(before, after)
    return { packs: results, idempotentReplay: false }
  }

  async toggleChecklist(actor: FinanceActorContext, command: ToggleChecklistCommand) {
    authorizeProvingAction(actor, command.orgId, 'proving.checklist.toggle')
    const before = await this.load()
    const claim = `proving_idem:${command.orgId}:${command.idempotencyKey}`
    if (before.claims.has(claim)) {
      const item = before.workspaces.get(command.orgId)?.acceptanceChecklist.find((i) => i.id === command.itemId)
      if (!item) throw new ProvingFinanceNotFoundError('Checklist item not found')
      return { item, idempotentReplay: true }
    }
    const after = cloneProvingStore(before)
    after.claims.add(claim)
    const ws = after.workspaces.get(command.orgId) ?? emptyWorkspace(command.orgId)
    if (!ws.acceptanceChecklist.length) ws.acceptanceChecklist = buildAcceptanceChecklist()
    const idx = ws.acceptanceChecklist.findIndex((i) => i.id === command.itemId)
    if (idx < 0) throw new ProvingFinanceNotFoundError('Checklist item not found')
    const now = this.now()
    const item: AcceptanceCheckItem = {
      ...ws.acceptanceChecklist[idx],
      checked: command.checked,
      checkedAt: command.checked ? now : undefined,
      checkedBy: command.checked ? actor.uid : undefined,
    }
    ws.acceptanceChecklist[idx] = item
    ws.audit.push({
      at: now,
      action: 'proving.checklist.toggle',
      actorId: actor.uid,
      summary: `${command.itemId} → ${command.checked}`,
      externalEgressAllowed: false,
    })
    after.workspaces.set(command.orgId, ws)
    await this.save(before, after)
    return { item, idempotentReplay: false }
  }
}

/** In-memory helper for tests and verify scripts. */
export function createInMemoryProvingService(now = () => '2026-08-03T12:00:00.000Z') {
  let store = createEmptyProvingStore()
  return new FinanceProvingService(
    async () => store,
    async (_before, after) => {
      store = after
    },
    now,
  )
}
