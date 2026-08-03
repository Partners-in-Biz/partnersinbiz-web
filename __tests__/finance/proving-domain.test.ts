import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import {
  DEFAULT_PROVING_SEED_KEY,
  PROVING_HARD_GATES,
  PROVING_SEED_VERSION,
  applyChecklistCheck,
  buildAccountantAcceptanceChecklistItems,
  buildDemoCompanySeed,
  buildPackagingWalkthrough,
  emptyChecklistState,
  runMultiPeriodCloseFixture,
  stableSeedDigest,
} from '@/lib/finance/proving/domain'
import {
  ProvingFinanceService,
  createEmptyProvingStore,
  cloneProvingStore,
  type ProvingFinanceStore,
} from '@/lib/finance/proving/service'
import { assertPeriodAllowsPosting } from '@/lib/accounting/foundation'
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

function memoryService(storeRef: { current: ProvingFinanceStore }, now = '2026-08-03T12:00:00.000Z') {
  return new ProvingFinanceService(
    async () => cloneProvingStore(storeRef.current),
    async (_before, after) => {
      storeRef.current = cloneProvingStore(after)
    },
    () => now,
  )
}

describe('proving kit domain — demo company seed', () => {
  test('builds multi-entity books with AR/AP, bank, payroll, FX, assets, jobs', () => {
    const company = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'kit-a' })
    expect(company.version).toBe(PROVING_SEED_VERSION)
    expect(company.entities).toHaveLength(3)
    expect(company.books.length).toBeGreaterThanOrEqual(3)
    expect(company.arDocuments.length).toBeGreaterThan(0)
    expect(company.apDocuments.length).toBeGreaterThan(0)
    expect(company.bankLines.length).toBeGreaterThan(0)
    expect(company.payRun.employeeCount).toBeGreaterThan(0)
    expect(company.fxRates[0]?.status).toBe('approved')
    expect(company.assets[0]?.method).toBe('straight_line')
    expect(company.jobDimensions.length).toBeGreaterThan(0)
    expect(company.hardGates).toEqual(PROVING_HARD_GATES)
    expect(company.periods.some((p) => p.status === 'open')).toBe(true)
    expect(company.periods.some((p) => p.status === 'hard_closed')).toBe(true)
  })

  test('seed is deterministic for the same seedKey', () => {
    const a = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'stable' })
    const b = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'stable' })
    expect(stableSeedDigest(a)).toBe(stableSeedDigest(b))
    expect(a.entities[0]?.id).toBe(b.entities[0]?.id)
    const c = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'other' })
    expect(a.entities[0]?.id).not.toBe(c.entities[0]?.id)
  })
})

describe('proving kit domain — multi-period close fixture', () => {
  test('open → blockers → clear → close → freeze invariants', () => {
    const company = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'close-a' })
    const result = runMultiPeriodCloseFixture({ company, closeMode: 'soft_closed' })

    expect(result.periodBeforeStatus).toBe('open')
    expect(result.periodAfterStatus).toBe('soft_closed')
    expect(result.blockersBefore.map((b) => b.code)).toEqual(
      expect.arrayContaining(['unreconciled_bank', 'unapproved_journals', 'open_pay_runs', 'missing_fx_reval']),
    )
    expect(result.blockersAfter).toHaveLength(0)
    expect(result.timeline.map((t) => t.step)).toEqual([
      'open_period',
      'post_activity',
      'evaluate_blockers',
      'clear_blockers',
      'close_period',
      'freeze_reports',
    ])
    expect(result.reportFreeze.trialBalanceBalanced).toBe(true)
    expect(result.reportFreeze.postingBlockedWithoutAdjustment).toBe(true)
    expect(result.reportFreeze.hardClosedBlocksAllPosting).toBe(true)
    expect(result.reportFreeze.inputDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(result.hardGates.externalPaymentInitiated).toBe(false)

    const open = company.periods.find((p) => p.status === 'open')!
    expect(() =>
      assertPeriodAllowsPosting(
        {
          id: open.id,
          orgId: company.orgId,
          legalEntityId: open.legalEntityId,
          bookId: open.bookId,
          fiscalYear: open.fiscalYear,
          periodNumber: open.periodNumber,
          startsAt: open.startsAt,
          endsAt: open.endsAt,
          status: 'soft_closed',
        },
        open.startsAt,
        false,
      ),
    ).toThrow(/soft closed/)
  })

  test('hard close freezes posting completely', () => {
    const company = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'close-hard' })
    const result = runMultiPeriodCloseFixture({ company, closeMode: 'hard_closed' })
    expect(result.periodAfterStatus).toBe('hard_closed')
    expect(result.reportFreeze.periodStatus).toBe('hard_closed')
    expect(result.reportFreeze.hardClosedBlocksAllPosting).toBe(true)
  })
})

describe('proving kit domain — packaging walkthrough', () => {
  test('builds realistic SARS/payment/accountant packs without submit/initiate', () => {
    const company = buildDemoCompanySeed({ orgId: 'org_pib', seedKey: 'pack-a' })
    const walk = buildPackagingWalkthrough({ company })
    expect(walk.packs.length).toBe(ALL_PACKAGING_KINDS.length)
    const families = new Set(walk.packs.map((p) => p.family))
    expect(families.has('sars')).toBe(true)
    expect(families.has('payment')).toBe(true)
    expect(families.has('accountant')).toBe(true)
    for (const pack of walk.packs) {
      expect(pack.fileNames.length).toBeGreaterThan(0)
      expect(pack.rowCount).toBeGreaterThan(0)
      expect(pack.digests.length).toBe(pack.fileNames.length)
      expect(pack.sarsSubmissionInitiated).toBe(false)
      expect(pack.externalPaymentInitiated).toBe(false)
      expect(pack.externalEgressAllowed).toBe(false)
      expect(pack.contentPreview.length).toBeGreaterThan(20)
      expect(pack.contentPreview).not.toMatch(/sarsSubmissionInitiated": true/)
      expect(pack.contentPreview).not.toMatch(/externalPaymentInitiated": true/)
    }
    expect(walk.hardGates).toEqual(PROVING_HARD_GATES)
  })
})

describe('proving kit domain — acceptance checklist', () => {
  test('required items drive sign-off readiness', () => {
    const items = buildAccountantAcceptanceChecklistItems()
    expect(items.length).toBeGreaterThanOrEqual(10)
    expect(items.every((i, idx) => i.printableOrder === idx + 1)).toBe(true)
    let state = emptyChecklistState('org_pib', DEFAULT_PROVING_SEED_KEY, '2026-08-03T12:00:00.000Z')
    expect(state.readyForAccountantSignoff).toBe(false)
    for (const item of items.filter((i) => i.required)) {
      state = applyChecklistCheck(state, {
        itemId: item.id,
        checked: true,
        now: '2026-08-03T12:01:00.000Z',
        checkedBy: 'u1',
      })
    }
    expect(state.readyForAccountantSignoff).toBe(true)
    expect(state.completedRequiredCount).toBe(state.requiredCount)
  })
})

describe('proving kit service — seed idempotency + auth', () => {
  test('seed is idempotent for same org+seedKey and refuses viewers on write', async () => {
    const storeRef = { current: createEmptyProvingStore() }
    const svc = memoryService(storeRef)
    const admin = actor('u1', 'org_pib')

    const first = await svc.seedDemoCompany(admin, {
      orgId: 'org_pib',
      seedKey: 'idem-1',
      requestId: 'r1',
      idempotencyKey: 'idem-seed-1',
    })
    const second = await svc.seedDemoCompany(admin, {
      orgId: 'org_pib',
      seedKey: 'idem-1',
      requestId: 'r2',
      idempotencyKey: 'idem-seed-2',
    })
    expect(second).toEqual(first)
    expect(storeRef.current.companies.size).toBe(1)
    expect(storeRef.current.auditEvents.filter((e) => e.action === 'proving.seed')).toHaveLength(1)

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
        idempotencyKey: 'idem-seed-3',
      }),
    ).rejects.toBeInstanceOf(FinanceAuthorizationError)
  })

  test('close fixture + packaging walkthrough + checklist write durable bundle', async () => {
    const storeRef = { current: createEmptyProvingStore() }
    const svc = memoryService(storeRef)
    const admin = actor('u1', 'org_pib')

    await svc.seedDemoCompany(admin, {
      orgId: 'org_pib',
      seedKey: 'full',
      requestId: 'r1',
      idempotencyKey: 's1',
    })
    const close = await svc.runCloseFixture(admin, {
      orgId: 'org_pib',
      seedKey: 'full',
      closeMode: 'soft_closed',
      requestId: 'r2',
      idempotencyKey: 'c1',
    })
    expect(close.reportFreeze.trialBalanceBalanced).toBe(true)

    // same idempotency key returns same fixture without double claim error path via map
    const closeAgain = await svc.runCloseFixture(admin, {
      orgId: 'org_pib',
      seedKey: 'full',
      requestId: 'r2b',
      idempotencyKey: 'c1',
    })
    expect(closeAgain.id).toBe(close.id)

    const pack = await svc.runPackagingWalkthrough(admin, {
      orgId: 'org_pib',
      seedKey: 'full',
      requestId: 'r3',
      idempotencyKey: 'p1',
    })
    expect(pack.packs.length).toBeGreaterThan(5)

    const checklist = await svc.setChecklistItem(admin, {
      orgId: 'org_pib',
      seedKey: 'full',
      itemId: 'hard_gates',
      checked: true,
      note: 'Gates held on dry-run',
      requestId: 'r4',
      idempotencyKey: 'k1',
    })
    expect(checklist.checks.hard_gates?.checked).toBe(true)

    const bundle = await svc.getBundle(admin, 'org_pib', 'full')
    expect(bundle.company?.seedKey).toBe('full')
    expect(bundle.latestCloseFixture?.periodAfterStatus).toBe('soft_closed')
    expect(bundle.latestPackagingWalkthrough?.packs.length).toBe(pack.packs.length)
    expect(bundle.checklist.checks.hard_gates?.checked).toBe(true)
    expect(bundle.hardGates.externalEgressAllowed).toBe(false)
    expect(bundle.company?.payRun.status).toBe('approved_locked')
    expect(bundle.company?.periods.find((p) => p.id === close.periodId)?.status).toBe('soft_closed')
  })
})
