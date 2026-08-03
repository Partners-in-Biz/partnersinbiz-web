import type { FinanceActorContext } from '@/lib/finance/types'
import { PROVING_SEED_KEY, defaultCloseBlockers, freezeTrialBalance } from '@/lib/finance/proving/demo-blueprint'
import { createInMemoryProvingService, seedSnapshotDigest } from '@/lib/finance/proving/service'

function actor(orgId = 'org-proving'): FinanceActorContext {
  return {
    uid: 'finance-admin',
    orgId,
    membershipRole: 'owner',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg-admin',
        orgId,
        userId: 'finance-admin',
        legalEntityId: 'any',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

function id() {
  return {
    requestId: `req-${Math.random().toString(16).slice(2)}`,
    idempotencyKey: `idem-${Math.random().toString(16).slice(2)}`,
  }
}

describe('finance proving kit domain', () => {
  test('default close blockers flag unmatched bank and open payroll', () => {
    const blockers = defaultCloseBlockers({
      bankLines: [
        {
          id: 'b1',
          entityId: 'e1',
          bookingDate: '2026-07-01',
          description: 'x',
          amountMinor: 1,
          currency: 'ZAR',
          matched: false,
        },
      ],
      payrollRuns: [
        {
          id: 'p1',
          entityId: 'e1',
          periodKey: '2026-07',
          status: 'in_review',
          employeeCount: 1,
          grossMinor: 1,
          payeMinor: 1,
          uifMinor: 1,
          sdlMinor: 1,
          netMinor: 1,
        },
      ],
      fxPositions: [
        {
          id: 'f1',
          entityId: 'e1',
          currency: 'USD',
          openTxnMinor: 1,
          functionalMinor: 1,
          rateScaled: 1_850_000_000,
          rateScale: 8,
          revaluationOpen: true,
        },
      ],
      assets: [
        {
          id: 'a1',
          entityId: 'e1',
          code: 'FA',
          name: 'Kit',
          costMinor: 100,
          residualMinor: 0,
          usefulLifeMonths: 12,
          depreciationPostedThrough: '2026-06',
        },
      ],
      periodKey: '2026-07',
      entityId: 'e1',
      cutoverComplete: false,
    })
    expect(blockers.filter((b) => !b.resolved).map((b) => b.code).sort()).toEqual(
      [
        'incomplete_cutover',
        'missing_depreciation',
        'open_fx_revaluation',
        'unapproved_pay_run',
        'unreconciled_bank',
      ].sort(),
    )
  })

  test('report freeze snapshot is immutable-shaped and balanced hash-stable', () => {
    const a = freezeTrialBalance({
      periodKey: '2026-07',
      entityId: 'e1',
      bookId: 'b1',
      frozenAt: '2026-08-03T00:00:00.000Z',
      lines: [
        { accountCode: '1100', debitMinor: 1000, creditMinor: 0 },
        { accountCode: '4000', debitMinor: 0, creditMinor: 1000 },
      ],
      journalCount: 1,
    })
    const b = freezeTrialBalance({
      periodKey: '2026-07',
      entityId: 'e1',
      bookId: 'b1',
      frozenAt: '2026-08-03T00:00:00.000Z',
      lines: [
        { accountCode: '1100', debitMinor: 1000, creditMinor: 0 },
        { accountCode: '4000', debitMinor: 0, creditMinor: 1000 },
      ],
      journalCount: 1,
    })
    expect(a.trialBalanceHash).toBe(b.trialBalanceHash)
    expect(a.totalDebitMinor).toBe(a.totalCreditMinor)
    expect(a.immutable).toBe(true)
    expect(a.externalEgressAllowed).toBe(false)
    expect(a.sarsSubmissionInitiated).toBe(false)
    expect(a.externalPaymentInitiated).toBe(false)
  })

  test('seed is multi-entity and idempotent by seedKey', async () => {
    const service = createInMemoryProvingService()
    const a = actor()
    const first = await service.seedDemoCompany(a, { orgId: a.orgId, seedKey: PROVING_SEED_KEY, ...id() })
    expect(first.idempotentReplay).toBe(false)
    expect(first.seed.entities).toHaveLength(3)
    expect(first.seed.entities.map((e) => e.code).sort()).toEqual(['HOLD', 'OPS', 'SVC'])
    expect(first.seed.journals.length).toBeGreaterThanOrEqual(9)
    expect(first.seed.arAp.length).toBeGreaterThan(0)
    expect(first.seed.bankLines.some((b) => !b.matched)).toBe(true)
    expect(first.seed.payrollRuns.some((p) => p.status === 'in_review')).toBe(true)
    expect(first.seed.fxPositions[0]?.rateScaled).toBe(1_850_000_000)
    expect(first.seed.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(first.seed.hardGates.externalPaymentInitiated).toBe(false)

    const second = await service.seedDemoCompany(a, { orgId: a.orgId, seedKey: PROVING_SEED_KEY, ...id() })
    expect(second.idempotentReplay).toBe(true)
    expect(seedSnapshotDigest(second.seed)).toBe(seedSnapshotDigest(first.seed))
    expect(second.seed.journals).toHaveLength(first.seed.journals.length)
  })

  test('close fixture blocks then freezes reports after resolve', async () => {
    const service = createInMemoryProvingService()
    const a = actor()
    await service.seedDemoCompany(a, { orgId: a.orgId, seedKey: PROVING_SEED_KEY, ...id() })

    const blocked = await service.runCloseFixture(a, {
      orgId: a.orgId,
      entityCode: 'OPS',
      periodKey: '2026-07',
      resolveBlockers: false,
      ...id(),
    })
    expect(blocked.closeRun.status).toBe('blocked')
    expect(blocked.closeRun.blockers.some((b) => !b.resolved)).toBe(true)
    expect(blocked.closeRun.freeze).toBeUndefined()

    const closed = await service.runCloseFixture(a, {
      orgId: a.orgId,
      entityCode: 'OPS',
      periodKey: '2026-07',
      resolveBlockers: true,
      ...id(),
    })
    expect(closed.closeRun.status).toBe('reports_frozen')
    expect(closed.closeRun.blockers.every((b) => b.resolved)).toBe(true)
    expect(closed.closeRun.freeze?.immutable).toBe(true)
    expect(closed.closeRun.freeze?.totalDebitMinor).toBe(closed.closeRun.freeze?.totalCreditMinor)
    expect(closed.closeRun.freeze?.externalEgressAllowed).toBe(false)

    const bundle = await service.getBundle(a, a.orgId)
    const period = bundle.workspace.seed?.periods.find(
      (p) => p.entityId === closed.closeRun.entityId && p.periodKey === '2026-07',
    )
    expect(period?.status).toBe('hard_closed')
  })

  test('packaging dry-run builds realistic packs with hard gates false', async () => {
    const service = createInMemoryProvingService()
    const a = actor()
    await service.seedDemoCompany(a, { orgId: a.orgId, seedKey: PROVING_SEED_KEY, ...id() })
    const dry = await service.packagingDryRun(a, { orgId: a.orgId, ...id() })
    expect(dry.packs.length).toBeGreaterThanOrEqual(11)
    for (const pack of dry.packs) {
      expect(pack.fileNames.length).toBeGreaterThan(0)
      expect(pack.rowCount).toBeGreaterThan(0)
      expect(pack.sarsSubmissionInitiated).toBe(false)
      expect(pack.externalPaymentInitiated).toBe(false)
      expect(pack.externalEgressAllowed).toBe(false)
    }
    const emp201 = dry.packs.find((p) => p.kind === 'sars.emp201')
    expect(emp201?.rowCount).toBeGreaterThan(0)
    const eft = dry.packs.find((p) => p.kind === 'payment.eft_instructions')
    expect(eft?.rowCount).toBeGreaterThan(0)
  })

  test('acceptance checklist toggles with evidence timestamps', async () => {
    const service = createInMemoryProvingService()
    const a = actor()
    const bundle0 = await service.getBundle(a, a.orgId)
    expect(bundle0.workspace.acceptanceChecklist.length).toBeGreaterThanOrEqual(12)
    const itemId = bundle0.workspace.acceptanceChecklist[0].id
    const toggled = await service.toggleChecklist(a, {
      orgId: a.orgId,
      itemId,
      checked: true,
      ...id(),
    })
    expect(toggled.item.checked).toBe(true)
    expect(toggled.item.checkedBy).toBe(a.uid)
    expect(toggled.item.checkedAt).toBeTruthy()
  })
})
