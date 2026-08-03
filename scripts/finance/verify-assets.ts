/**
 * Development/staging verification for fixed assets + straight-line depreciation.
 * No external egress / SARS / payment initiation.
 */
import {
  InMemoryAssetsFinanceService,
} from '../../lib/accounting/assets-service'
import type { FinanceActorContext } from '../../lib/finance/types'

const now = '2026-08-02T12:00:00.000Z'
const scope = { orgId: 'org-verify', legalEntityId: 'entity-verify', bookId: 'book-verify' }

const admin: FinanceActorContext = {
  uid: 'verify-admin',
  orgId: scope.orgId,
  membershipRole: 'owner',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [{
    id: 'a1',
    orgId: scope.orgId,
    userId: 'verify-admin',
    legalEntityId: scope.legalEntityId,
    scopeMode: 'entity',
    role: 'finance_admin',
    status: 'active',
  }],
}

const approver: FinanceActorContext = {
  ...admin,
  uid: 'verify-approver',
  membershipRole: 'admin',
  assignments: [{
    id: 'a2',
    orgId: scope.orgId,
    userId: 'verify-approver',
    legalEntityId: scope.legalEntityId,
    scopeMode: 'entity',
    role: 'finance_approver',
    status: 'active',
  }],
}

async function main() {
  const svc = new InMemoryAssetsFinanceService(undefined, () => now)
  const req = (k: string) => ({ requestId: `verify-${k}`, idempotencyKey: `verify-idem-${k}` })

  await svc.createAssetClass(admin, {
    id: 'class-verify',
    ...scope,
    code: 'OFFICE',
    name: 'Office equipment',
    usefulLifeMonths: 2,
    defaultResidualMinor: 0,
    assetAccountId: 'acc-cost',
    accumulatedDepAccountId: 'acc-accum',
    expenseAccountId: 'acc-exp',
    expectedVersion: 0,
    ...req('class'),
  })

  await svc.createFixedAsset(admin, {
    id: 'fa-verify',
    ...scope,
    assetNumber: 'FA-V-1',
    name: 'Desk',
    assetClassId: 'class-verify',
    currency: 'ZAR',
    costMinor: 20_00,
    acquisitionDate: '2026-07-01',
    inServiceDate: '2026-07-01',
    expectedVersion: 0,
    ...req('asset'),
  })
  await svc.activateFixedAsset(admin, {
    id: 'fa-verify',
    ...scope,
    expectedVersion: 1,
    ...req('activate'),
  })

  for (const period of ['2026-07', '2026-08'] as const) {
    const run = await svc.createDepreciationRun(admin, {
      id: `run-${period}`,
      ...scope,
      periodKey: period,
      postingDate: `${period}-28`,
      expectedVersion: 0,
      ...req(`run-${period}`),
    })
    const calculated = await svc.calculateDepreciationRun(admin, {
      id: run.id,
      ...scope,
      expectedVersion: run.version,
      ...req(`calc-${period}`),
    })
    if (calculated.totalDepreciationMinor !== 10_00) {
      throw new Error(`Expected 1000 minor depreciation for ${period}, got ${calculated.totalDepreciationMinor}`)
    }
    const posted = await svc.postDepreciationRun(approver, {
      id: run.id,
      ...scope,
      approvalId: `appr-${period}`,
      reason: 'verify',
      expectedVersion: calculated.version,
      ...req(`post-${period}`),
    })
    if (posted.status !== 'approved_posted') throw new Error('Run not posted')
    if (posted.externalPaymentInitiated !== false || posted.sarsSubmissionInitiated !== false) {
      throw new Error('Hard gates violated on depreciation run')
    }
  }

  const asset = svc.storeRef.current.assets.get('fa-verify')
  if (!asset || asset.status !== 'fully_depreciated' || asset.netBookValueMinor !== 0) {
    throw new Error('Asset not fully depreciated as expected')
  }

  const disposal = await svc.disposeFixedAsset(approver, {
    id: 'disp-verify',
    ...scope,
    assetId: 'fa-verify',
    disposedAt: '2026-08-15',
    proceedsMinor: 250,
    proceedsAccountId: 'acc-bank',
    gainLossAccountId: 'acc-gl',
    approvalId: 'appr-disp',
    reason: 'verify dispose',
    expectedVersion: 0,
    ...req('dispose'),
  })
  if (disposal.disposal.gainLossMinor !== 250) throw new Error('Unexpected disposal gain')
  if (disposal.disposal.externalPaymentInitiated !== false || disposal.disposal.sarsSubmissionInitiated !== false) {
    throw new Error('Hard gates violated on disposal')
  }

  const register = await svc.buildRegisterReport(admin, scope, '2026-08-15')
  if (register.assetCount !== 1 || register.totalCostMinor !== 20_00) {
    throw new Error('Register report mismatch')
  }

  console.log(JSON.stringify({
    ok: true,
    assetStatus: disposal.asset.status,
    disposalGainLossMinor: disposal.disposal.gainLossMinor,
    registerNbvMinor: register.totalNbvMinor,
    hardGates: {
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
