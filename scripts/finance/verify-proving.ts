/**
 * Finance proving kit verify script — seed + close freeze + packaging gates.
 * No SARS submit, no payment initiate, no external egress.
 */
import {
  DEFAULT_PROVING_SEED_KEY,
  PROVING_HARD_GATES,
  buildDemoCompanySeed,
  buildPackagingWalkthrough,
  runMultiPeriodCloseFixture,
} from '../../lib/finance/proving/domain'
import {
  ProvingFinanceService,
  createEmptyProvingStore,
  cloneProvingStore,
} from '../../lib/finance/proving/service'
import type { FinanceActorContext } from '../../lib/finance/types'

function actor(): FinanceActorContext {
  return {
    uid: 'verify-admin',
    orgId: 'org_verify_proving',
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg',
        orgId: 'org_verify_proving',
        userId: 'verify-admin',
        legalEntityId: 'le',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

async function main() {
  const company = buildDemoCompanySeed({ orgId: 'org_verify_proving', seedKey: DEFAULT_PROVING_SEED_KEY })
  if (company.entities.length < 3) throw new Error('expected multi-entity seed')
  const close = runMultiPeriodCloseFixture({ company })
  if (!close.reportFreeze.trialBalanceBalanced) throw new Error('TB not balanced after freeze')
  if (!close.reportFreeze.postingBlockedWithoutAdjustment) throw new Error('posting should block after close')
  const pack = buildPackagingWalkthrough({ company })
  if (pack.packs.length < 10) throw new Error('expected full packaging dry-run set')
  for (const p of pack.packs) {
    if (p.sarsSubmissionInitiated || p.externalPaymentInitiated || p.externalEgressAllowed) {
      throw new Error(`hard gate failed on ${p.kind}`)
    }
  }

  let store = createEmptyProvingStore()
  const svc = new ProvingFinanceService(
    async () => cloneProvingStore(store),
    async (_b, after) => {
      store = cloneProvingStore(after)
    },
    () => '2026-08-03T15:00:00.000Z',
  )
  const a = actor()
  const seeded = await svc.seedDemoCompany(a, {
    orgId: 'org_verify_proving',
    requestId: 'v1',
    idempotencyKey: 'v-seed',
  })
  const seeded2 = await svc.seedDemoCompany(a, {
    orgId: 'org_verify_proving',
    requestId: 'v2',
    idempotencyKey: 'v-seed-2',
  })
  if (JSON.stringify(seeded) !== JSON.stringify(seeded2)) throw new Error('seed not idempotent')

  const closeSvc = await svc.runCloseFixture(a, {
    orgId: 'org_verify_proving',
    requestId: 'v3',
    idempotencyKey: 'v-close',
  })
  const packSvc = await svc.runPackagingWalkthrough(a, {
    orgId: 'org_verify_proving',
    requestId: 'v4',
    idempotencyKey: 'v-pack',
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        entities: company.entities.length,
        books: company.books.length,
        closePeriod: closeSvc.periodAfterStatus,
        freezeDigest: closeSvc.reportFreeze.inputDigest.slice(0, 16),
        packs: packSvc.packs.length,
        hardGates: PROVING_HARD_GATES,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        noEgress: true,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
