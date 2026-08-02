import {
  buildStraightLineSchedule,
  comparePeriodKeys,
  computeDisposalGainLoss,
  depreciableBaseMinor,
  FinanceValidationError,
  netBookValueMinor,
  periodKeyFromDate,
} from '@/lib/accounting/assets'
import { InMemoryAssetsFinanceService } from '@/lib/accounting/assets-service'
import type { FinanceActorContext } from '@/lib/finance/types'

const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

function actor(uid = 'admin-1', role: FinanceActorContext['assignments'][number]['role'] = 'finance_admin'): FinanceActorContext {
  return {
    uid,
    orgId: scope.orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [{
      id: `asg-${uid}`,
      orgId: scope.orgId,
      userId: uid,
      legalEntityId: scope.legalEntityId,
      scopeMode: 'entity',
      role,
      status: 'active',
    }],
  }
}

describe('fixed asset straight-line math', () => {
  test('builds schedule with remainder absorbed in final month', () => {
    const schedule = buildStraightLineSchedule({
      costMinor: 100_00,
      residualValueMinor: 10_00,
      usefulLifeMonths: 3,
      inServiceDate: '2026-01-15',
    })
    expect(schedule).toHaveLength(3)
    expect(schedule.map((l) => l.amountMinor)).toEqual([30_00, 30_00, 30_00])
    expect(schedule[2].cumulativeMinor).toBe(90_00)
    expect(schedule[2].closingNbvMinor).toBe(10_00)
    expect(schedule[0].periodKey).toBe('2026-01')
    expect(schedule[2].periodKey).toBe('2026-03')
  })

  test('handles non-divisible bases with final catch-up', () => {
    const schedule = buildStraightLineSchedule({
      costMinor: 10_000,
      residualValueMinor: 0,
      usefulLifeMonths: 3,
      inServiceDate: '2026-07-01',
    })
    // floor(10000/3)=3333; final = 10000 - 6666 = 3334
    expect(schedule.map((l) => l.amountMinor)).toEqual([3333, 3333, 3334])
    expect(schedule.reduce((s, l) => s + l.amountMinor, 0)).toBe(depreciableBaseMinor(10_000, 0))
  })

  test('disposal gain/loss and NBV helpers', () => {
    expect(netBookValueMinor(50_000, 12_000)).toBe(38_000)
    expect(computeDisposalGainLoss({ proceedsMinor: 40_000, nbvAtDisposalMinor: 38_000 })).toBe(2_000)
    expect(computeDisposalGainLoss({ proceedsMinor: 10_000, nbvAtDisposalMinor: 38_000 })).toBe(-28_000)
    expect(periodKeyFromDate('2026-08-02')).toBe('2026-08')
    expect(comparePeriodKeys('2026-07', '2026-08')).toBeLessThan(0)
    expect(() => buildStraightLineSchedule({
      costMinor: 100,
      residualValueMinor: 200,
      usefulLifeMonths: 12,
      inServiceDate: '2026-01-01',
    })).toThrow(FinanceValidationError)
  })
})

describe('fixed asset register and depreciation lifecycle', () => {
  test('class → asset → activate → monthly run → post → dispose never initiates payment/SARS', async () => {
    const svc = new InMemoryAssetsFinanceService()
    const admin = actor('admin-1')
    const poster = actor('poster-1', 'finance_approver')

    const assetClass = await svc.createAssetClass(admin, {
      id: 'class-comp',
      ...scope,
      code: 'comp',
      name: 'Computers',
      usefulLifeMonths: 3,
      defaultResidualMinor: 0,
      assetAccountId: 'acc-cost',
      accumulatedDepAccountId: 'acc-accum',
      expenseAccountId: 'acc-exp',
      expectedVersion: 0,
      requestId: 'r1',
      idempotencyKey: 'idem-class',
    })
    expect(assetClass.depreciationMethod).toBe('straight_line')

    const asset = await svc.createFixedAsset(admin, {
      id: 'fa-1',
      ...scope,
      assetNumber: 'FA-1',
      name: 'Laptop',
      assetClassId: assetClass.id,
      currency: 'ZAR',
      costMinor: 9_000,
      acquisitionDate: '2026-01-01',
      inServiceDate: '2026-01-01',
      expectedVersion: 0,
      requestId: 'r2',
      idempotencyKey: 'idem-asset',
    })
    expect(asset.status).toBe('draft')
    expect(asset.sarsSubmissionInitiated).toBe(false)
    expect(asset.externalPaymentInitiated).toBe(false)

    const active = await svc.activateFixedAsset(admin, {
      id: asset.id,
      ...scope,
      expectedVersion: 1,
      requestId: 'r3',
      idempotencyKey: 'idem-act',
    })
    expect(active.status).toBe('active')

    const run = await svc.createDepreciationRun(admin, {
      id: 'run-2026-01',
      ...scope,
      periodKey: '2026-01',
      postingDate: '2026-01-31',
      expectedVersion: 0,
      requestId: 'r4',
      idempotencyKey: 'idem-run',
    })
    const calculated = await svc.calculateDepreciationRun(admin, {
      id: run.id,
      ...scope,
      expectedVersion: 1,
      requestId: 'r5',
      idempotencyKey: 'idem-calc',
    })
    expect(calculated.status).toBe('calculated')
    expect(calculated.itemCount).toBe(1)
    expect(calculated.totalDepreciationMinor).toBe(3_000)
    expect(calculated.sarsSubmissionInitiated).toBe(false)
    expect(calculated.externalPaymentInitiated).toBe(false)

    const posted = await svc.postDepreciationRun(poster, {
      id: run.id,
      ...scope,
      approvalId: 'appr-1',
      reason: 'OK',
      expectedVersion: calculated.version,
      requestId: 'r6',
      idempotencyKey: 'idem-post',
    })
    expect(posted.status).toBe('approved_posted')
    expect(posted.journalEntryId).toBeTruthy()

    const after = svc.storeRef.current.assets.get('fa-1')!
    expect(after.accumulatedDepreciationMinor).toBe(3_000)
    expect(after.netBookValueMinor).toBe(6_000)
    expect(after.lastDepreciationPeriodKey).toBe('2026-01')

    // second and third months
    for (const [period, versionHint, amount] of [
      ['2026-02', 1, 3_000],
      ['2026-03', 1, 3_000],
    ] as const) {
      const r = await svc.createDepreciationRun(admin, {
        id: `run-${period}`,
        ...scope,
        periodKey: period,
        postingDate: `${period}-28`,
        expectedVersion: 0,
        requestId: `r-${period}-c`,
        idempotencyKey: `idem-${period}-c`,
      })
      const c = await svc.calculateDepreciationRun(admin, {
        id: r.id,
        ...scope,
        expectedVersion: versionHint,
        requestId: `r-${period}-k`,
        idempotencyKey: `idem-${period}-k`,
      })
      expect(c.totalDepreciationMinor).toBe(amount)
      await svc.postDepreciationRun(poster, {
        id: r.id,
        ...scope,
        approvalId: `appr-${period}`,
        reason: 'OK',
        expectedVersion: c.version,
        requestId: `r-${period}-p`,
        idempotencyKey: `idem-${period}-p`,
      })
    }

    const fully = svc.storeRef.current.assets.get('fa-1')!
    expect(fully.status).toBe('fully_depreciated')
    expect(fully.netBookValueMinor).toBe(0)
    expect(fully.accumulatedDepreciationMinor).toBe(9_000)

    const register = await svc.buildRegisterReport(admin, scope, '2026-03-31')
    expect(register.assetCount).toBe(1)
    expect(register.totalCostMinor).toBe(9_000)
    expect(register.totalNbvMinor).toBe(0)

    const disposed = await svc.disposeFixedAsset(poster, {
      id: 'disp-1',
      ...scope,
      assetId: 'fa-1',
      disposedAt: '2026-04-01',
      proceedsMinor: 500,
      proceedsAccountId: 'acc-bank',
      gainLossAccountId: 'acc-gl',
      approvalId: 'appr-disp',
      reason: 'Sold',
      expectedVersion: 0,
      requestId: 'r-disp',
      idempotencyKey: 'idem-disp',
    })
    expect(disposed.disposal.status).toBe('posted')
    expect(disposed.disposal.gainLossMinor).toBe(500)
    expect(disposed.disposal.externalPaymentInitiated).toBe(false)
    expect(disposed.disposal.sarsSubmissionInitiated).toBe(false)
    expect(disposed.asset.status).toBe('disposed')
    expect(disposed.asset.netBookValueMinor).toBe(0)
  })

  test('rejects duplicate period runs and out-of-order depreciation', async () => {
    const svc = new InMemoryAssetsFinanceService()
    const admin = actor()
    await svc.createAssetClass(admin, {
      id: 'class-1',
      ...scope,
      code: 'VEH',
      name: 'Vehicles',
      usefulLifeMonths: 12,
      assetAccountId: 'c',
      accumulatedDepAccountId: 'a',
      expenseAccountId: 'e',
      expectedVersion: 0,
      requestId: 'x1',
      idempotencyKey: 'x1',
    })
    await svc.createFixedAsset(admin, {
      id: 'fa-2',
      ...scope,
      assetNumber: 'FA-2',
      name: 'Bakkie',
      assetClassId: 'class-1',
      currency: 'ZAR',
      costMinor: 120_000,
      acquisitionDate: '2026-01-01',
      inServiceDate: '2026-01-01',
      expectedVersion: 0,
      requestId: 'x2',
      idempotencyKey: 'x2',
    })
    await svc.activateFixedAsset(admin, {
      id: 'fa-2',
      ...scope,
      expectedVersion: 1,
      requestId: 'x3',
      idempotencyKey: 'x3',
    })
    await svc.createDepreciationRun(admin, {
      id: 'run-a',
      ...scope,
      periodKey: '2026-01',
      postingDate: '2026-01-31',
      expectedVersion: 0,
      requestId: 'x4',
      idempotencyKey: 'x4',
    })
    await expect(svc.createDepreciationRun(admin, {
      id: 'run-b',
      ...scope,
      periodKey: '2026-01',
      postingDate: '2026-01-31',
      expectedVersion: 0,
      requestId: 'x5',
      idempotencyKey: 'x5',
    })).rejects.toThrow(/already exists for this period/i)
  })
})
