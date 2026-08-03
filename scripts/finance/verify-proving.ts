/**
 * Finance proving kit verify — seed + close freeze + packaging gates.
 * No SARS submit, no payment initiate, no external egress.
 */
import { ALL_PACKAGING_KINDS } from '../../lib/finance/packaging/service'
import { PROVING_SEED_KEY } from '../../lib/finance/proving/demo-blueprint'
import { createInMemoryProvingService, seedSnapshotDigest } from '../../lib/finance/proving/service'
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
  const svc = createInMemoryProvingService(() => '2026-08-03T15:00:00.000Z')
  const a = actor()

  const seeded = await svc.seedDemoCompany(a, {
    orgId: 'org_verify_proving',
    seedKey: PROVING_SEED_KEY,
    requestId: 'v1',
    idempotencyKey: 'v-seed',
  })
  const seeded2 = await svc.seedDemoCompany(a, {
    orgId: 'org_verify_proving',
    seedKey: PROVING_SEED_KEY,
    requestId: 'v2',
    idempotencyKey: 'v-seed-2',
  })
  if (!seeded2.idempotentReplay) throw new Error('expected idempotent seed replay')
  if (seedSnapshotDigest(seeded.seed) !== seedSnapshotDigest(seeded2.seed)) {
    throw new Error('seed digest drift on re-seed')
  }
  if (seeded.seed.entities.length < 3) throw new Error('expected multi-entity seed')

  const blocked = await svc.runCloseFixture(a, {
    orgId: 'org_verify_proving',
    entityCode: 'OPS',
    periodKey: '2026-07',
    resolveBlockers: false,
    requestId: 'v3a',
    idempotencyKey: 'v-close-block',
  })
  if (blocked.closeRun.status !== 'blocked') throw new Error('expected blockers before resolve')

  const closed = await svc.runCloseFixture(a, {
    orgId: 'org_verify_proving',
    entityCode: 'OPS',
    periodKey: '2026-07',
    resolveBlockers: true,
    requestId: 'v3',
    idempotencyKey: 'v-close',
  })
  if (!closed.closeRun.freeze) throw new Error('expected freeze snapshot')
  if (closed.closeRun.freeze.totalDebitMinor !== closed.closeRun.freeze.totalCreditMinor) {
    throw new Error('TB freeze not balanced')
  }
  if (closed.closeRun.freeze.externalPaymentInitiated || closed.closeRun.freeze.sarsSubmissionInitiated) {
    throw new Error('freeze violated hard gates')
  }

  const pack = await svc.packagingDryRun(a, {
    orgId: 'org_verify_proving',
    requestId: 'v4',
    idempotencyKey: 'v-pack',
  })
  if (pack.packs.length !== ALL_PACKAGING_KINDS.length) {
    throw new Error(`expected ${ALL_PACKAGING_KINDS.length} packs, got ${pack.packs.length}`)
  }
  for (const p of pack.packs) {
    if (p.sarsSubmissionInitiated || p.externalPaymentInitiated || p.externalEgressAllowed) {
      throw new Error(`hard gate failed on ${p.kind}`)
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        entities: seeded.seed.entities.length,
        seedKey: seeded.seed.seedKey,
        closeStatus: closed.closeRun.status,
        freezeHash: closed.closeRun.freeze.trialBalanceHash.slice(0, 16),
        packs: pack.packs.length,
        hardGates: seeded.seed.hardGates,
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
