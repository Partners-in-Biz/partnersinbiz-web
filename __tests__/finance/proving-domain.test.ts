import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
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
} from '@/lib/finance/proving/demo-blueprint'
import {
  FinanceProvingService,
  createEmptyProvingStore,
  cloneProvingStore,
  createInMemoryProvingService,
  seedSnapshotDigest,
  type ProvingStore,
} from '@/lib/finance/proving/service'
import { ALL_PACKAGING_KINDS } from '@/lib/finance/packaging/service'

function actor(uid: string, orgId: string, role: FinanceActorContext['membershipRole'] = 'admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role,
    membershipActive: true,
    financeModuleEnabled: true,
    assignments:
      role === 'owner' || role === 'admin'
        ? [
            {
              id: 'asg1',
              orgId,
              userId: uid,
              legalEntityId: 'le_any',
              scopeMode: 'entity',
              role: 'finance_admin',
              status: 'active',
            },
          ]
        : [],
  }
}

describe('proving kit blueprint', () => {
  test('multi-entity demo data covers AR/AP, bank, payroll, FX, assets, jobs', () => {
    const entities = buildDemoEntities('org_pib')
    expect(entities).toHaveLength(3)
    expect(entities.map((e) => e.code).sort()).toEqual(['HOLD', 'OPS', 'SVC'])
    expect(buildDemoArAp(entities).length).toBeGreaterThan(0)
    expect(buildDemoBankLines(entities).length).toBeGreaterThan(0)
    expect(buildDemoPayroll(entities).length).toBeGreaterThan(0)
    expect(buildDemoFx(entities).length).toBeGreaterThan(0)
    expect(buildDemoAssets(entities).length).toBeGreaterThan(0)
    expect(buildDemoJobCosts(entities).length).toBeGreaterThan(0)

    const ops = entities.find((e) => e.code === 'OPS')!
    const blockers = defaultCloseBlockers({
      bankLines: buildDemoBankLines(entities),
      payrollRuns: buildDemoPayroll(entities),
      fxPositions: buildDemoFx(entities),
      assets: buildDemoAssets(entities),
      periodKey: '2026-07',
      entityId: ops.id,
      cutoverComplete: true,
    })
    expect(blockers.some((b) => !b.resolved)).toBe(true)
    expect(blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(['unreconciled_bank', 'unapproved_pay_run', 'open_fx_revaluation']),
    )
  })

  test('freeze trial balance is balanced and gate-safe', () => {
    const freeze = freezeTrialBalance({
      periodKey: '2026-07',
      entityId: 'e1',
      bookId: 'b1',
      frozenAt: '2026-08-03T12:00:00.000Z',
      journalCount: 2,
      lines: [
        { accountCode: '1000', debitMinor: 5000, creditMinor: 0 },
        { accountCode: '4000', debitMinor: 0, creditMinor: 5000 },
      ],
    })
    expect(freeze.totalDebitMinor).toBe(freeze.totalCreditMinor)
    expect(freeze.immutable).toBe(true)
    expect(freeze.sarsSubmissionInitiated).toBe(false)
    expect(freeze.externalPaymentInitiated).toBe(false)
    expect(freeze.trialBalanceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('acceptance checklist is printable ordered steps', () => {
    const items = buildAcceptanceChecklist()
    expect(items.length).toBeGreaterThanOrEqual(10)
    expect(items.every((i, idx) => i.step === idx + 1)).toBe(true)
    expect(items.filter((i) => i.required).length).toBeGreaterThan(5)
    expect(items.every((i) => i.checked === false)).toBe(true)
  })
})

describe('proving kit service — seed idempotency + close + packaging', () => {
  test('seed is deterministic/idempotent and blocks viewers on write', async () => {
    const svc = createInMemoryProvingService()
    const admin = actor('u1', 'org_pib')
    const first = await svc.seedDemoCompany(admin, {
      orgId: 'org_pib',
      seedKey: PROVING_SEED_KEY,
      requestId: 'r1',
      idempotencyKey: 'seed-1',
    })
    expect(first.seed.entities).toHaveLength(3)
    expect(first.seed.arAp.length).toBeGreaterThan(0)
    expect(first.seed.bankLines.length).toBeGreaterThan(0)
    expect(first.seed.payrollRuns.length).toBeGreaterThan(0)
    expect(first.seed.fxPositions.length).toBeGreaterThan(0)
    expect(first.seed.assets.length).toBeGreaterThan(0)
    expect(first.seed.jobCosts.length).toBeGreaterThan(0)
    expect(first.seed.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(first.seed.hardGates.externalPaymentInitiated).toBe(false)
    expect(first.idempotentReplay).toBe(false)

    const second = await svc.seedDemoCompany(admin, {
      orgId: 'org_pib',
      seedKey: PROVING_SEED_KEY,
      requestId: 'r2',
      idempotencyKey: 'seed-2',
    })
    expect(second.idempotentReplay).toBe(true)
    expect(seedSnapshotDigest(second.seed)).toBe(seedSnapshotDigest(first.seed))

    const sameIdem = await svc.seedDemoCompany(admin, {
      orgId: 'org_pib',
      requestId: 'r1b',
      idempotencyKey: 'seed-1',
    })
    expect(sameIdem.idempotentReplay).toBe(true)

    const viewer: FinanceActorContext = {
      uid: 'v1',
      orgId: 'org_pib',
      membershipRole: 'member',
      membershipActive: true,
      financeModuleEnabled: true,
      assignments: [
        {
          id: 'asg_v',
          orgId: 'org_pib',
          userId: 'v1',
          legalEntityId: 'le',
          scopeMode: 'entity',
          role: 'finance_viewer',
          status: 'active',
        },
      ],
    }
    await expect(
      svc.seedDemoCompany(viewer, {
        orgId: 'org_pib',
        requestId: 'r3',
        idempotencyKey: 'seed-viewer',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })

  test('close fixture blockers then freeze; packaging dry-run holds hard gates', async () => {
    const svc = createInMemoryProvingService()
    const admin = actor('u1', 'org_close')
    await svc.seedDemoCompany(admin, {
      orgId: 'org_close',
      requestId: 's1',
      idempotencyKey: 's1',
    })

    const blocked = await svc.runCloseFixture(admin, {
      orgId: 'org_close',
      entityCode: 'OPS',
      periodKey: '2026-07',
      resolveBlockers: false,
      requestId: 'c-block',
      idempotencyKey: 'c-block',
    })
    expect(blocked.closeRun.status).toBe('blocked')
    expect(blocked.closeRun.blockers.some((b) => !b.resolved)).toBe(true)

    const closed = await svc.runCloseFixture(admin, {
      orgId: 'org_close',
      entityCode: 'OPS',
      periodKey: '2026-07',
      resolveBlockers: true,
      requestId: 'c-close',
      idempotencyKey: 'c-close',
    })
    expect(['closed', 'reports_frozen']).toContain(closed.closeRun.status)
    expect(closed.closeRun.blockers.every((b) => b.resolved)).toBe(true)
    expect(closed.closeRun.freeze?.immutable).toBe(true)
    expect(closed.closeRun.freeze?.totalDebitMinor).toBe(closed.closeRun.freeze?.totalCreditMinor)
    expect(closed.closeRun.freeze?.sarsSubmissionInitiated).toBe(false)
    expect(closed.closeRun.freeze?.externalPaymentInitiated).toBe(false)

    const pack = await svc.packagingDryRun(admin, {
      orgId: 'org_close',
      requestId: 'p1',
      idempotencyKey: 'p1',
    })
    expect(pack.packs.length).toBe(ALL_PACKAGING_KINDS.length)
    const families = new Set(pack.packs.map((p) => p.family))
    expect(families.has('sars')).toBe(true)
    expect(families.has('payment')).toBe(true)
    expect(families.has('accountant')).toBe(true)
    for (const p of pack.packs) {
      expect(p.fileNames.length).toBeGreaterThan(0)
      expect(p.sarsSubmissionInitiated).toBe(false)
      expect(p.externalPaymentInitiated).toBe(false)
      expect(p.externalEgressAllowed).toBe(false)
    }

    const toggled = await svc.toggleChecklist(admin, {
      orgId: 'org_close',
      itemId: 'acc_11',
      checked: true,
      requestId: 't1',
      idempotencyKey: 't1',
    })
    expect(toggled.item.checked).toBe(true)

    const bundle = await svc.getBundle(admin, 'org_close')
    expect(bundle.workspace.seed?.entities).toHaveLength(3)
    expect(bundle.workspace.closeRuns.length).toBeGreaterThanOrEqual(2)
    expect(bundle.workspace.packagingDryRuns.length).toBe(ALL_PACKAGING_KINDS.length)
    expect(bundle.workspace.acceptanceChecklist.find((i) => i.id === 'acc_11')?.checked).toBe(true)
    expect(bundle.hardGates.externalEgressAllowed).toBe(false)
    expect(bundle.printReady).toBe(true)
  })

  test('createInMemory store clone helper keeps isolation shape', () => {
    const store = createEmptyProvingStore()
    const cloned = cloneProvingStore(store)
    expect(cloned.workspaces).not.toBe(store.workspaces)
    expect(cloned.claims).not.toBe(store.claims)
    const typed: ProvingStore = cloned
    expect(typed.foundationByOrg.size).toBe(0)
    expect(new FinanceProvingService(async () => store, async () => undefined)).toBeInstanceOf(FinanceProvingService)
  })
})
