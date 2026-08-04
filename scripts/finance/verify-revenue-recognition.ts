/**
 * Development/staging verification for lite revenue recognition.
 * No external egress / SARS / payment initiation.
 */
import { InMemoryRevenueRecognitionService } from '../../lib/accounting/revenue-recognition-service'
import type { FinanceActorContext } from '../../lib/finance/types'

const now = '2026-08-03T12:00:00.000Z'
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
  const svc = new InMemoryRevenueRecognitionService(undefined, () => now)
  const req = (k: string) => ({ requestId: `verify-${k}`, idempotencyKey: `verify-idem-${k}` })

  await svc.createSchedule(admin, {
    id: 'sch-verify',
    ...scope,
    scheduleNumber: 'RR-V-1',
    name: 'SaaS retainer',
    arInvoiceId: 'inv-v-1',
    contractRef: 'CTR-V-1',
    currency: 'ZAR',
    method: 'straight_line',
    totalContractMinor: 12_000_00,
    months: 3,
    startDate: '2026-06-01',
    deferredRevenueAccountId: 'acc-def',
    revenueAccountId: 'acc-rev',
    expectedVersion: 0,
    ...req('sch'),
  })
  await svc.activateSchedule(admin, {
    id: 'sch-verify',
    ...scope,
    expectedVersion: 1,
    ...req('act'),
  })

  for (const period of ['2026-06', '2026-07', '2026-08'] as const) {
    const run = await svc.createRecognitionRun(admin, {
      id: `run-${period}`,
      ...scope,
      periodKey: period,
      postingDate: `${period}-28`,
      expectedVersion: 0,
      ...req(`run-${period}`),
    })
    const calculated = await svc.calculateRecognitionRun(admin, {
      id: run.id,
      ...scope,
      expectedVersion: run.version,
      ...req(`calc-${period}`),
    })
    if (calculated.totalRecognizedMinor !== 4_000_00) {
      throw new Error(`Expected 400000 minor for ${period}, got ${calculated.totalRecognizedMinor}`)
    }
    const posted = await svc.postRecognitionRun(approver, {
      id: run.id,
      ...scope,
      approvalId: `appr-${period}`,
      reason: 'verify',
      expectedVersion: calculated.version,
      ...req(`post-${period}`),
    })
    if (posted.status !== 'approved_posted') throw new Error('Run not posted')
    if (posted.externalPaymentInitiated !== false || posted.sarsSubmissionInitiated !== false || posted.externalEgressAllowed !== false) {
      throw new Error('Hard gates violated on recognition run')
    }
  }

  const sch = svc.storeRef.current.schedules.get('sch-verify')
  if (!sch || sch.status !== 'completed' || sch.deferredBalanceMinor !== 0 || sch.recognizedMinor !== 12_000_00) {
    throw new Error('Schedule not fully recognized as expected')
  }

  // reverse last month and re-check deferred
  const last = svc.storeRef.current.recognitionRuns.get('run-2026-08')!
  const reversed = await svc.reverseRecognitionRun(approver, {
    id: last.id,
    ...scope,
    approvalId: 'appr-rev',
    reason: 'verify reverse',
    expectedVersion: last.version,
    ...req('rev'),
  })
  if (reversed.status !== 'reversed') throw new Error('reverse failed')

  const after = svc.storeRef.current.schedules.get('sch-verify')!
  if (after.deferredBalanceMinor !== 4_000_00 || after.recognizedMinor !== 8_000_00) {
    throw new Error('Reverse balances mismatch')
  }

  const deferred = await svc.deferredRevenueReport(admin, scope, '2026-08')
  const vs = await svc.recognizedVsBilledReport(admin, scope, '2026-08')
  if (deferred.totalDeferredMinor !== 4_000_00) throw new Error('deferred report mismatch')
  if (vs.recognizedBps !== 6666) throw new Error(`recognized bps expected 6666 got ${vs.recognizedBps}`)

  console.log(JSON.stringify({
    ok: true,
    scheduleStatus: after.status,
    recognizedMinor: after.recognizedMinor,
    deferredBalanceMinor: after.deferredBalanceMinor,
    reversedRunStatus: reversed.status,
    hardGates: {
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
