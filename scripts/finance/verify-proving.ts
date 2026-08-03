import { PROVING_SEED_KEY } from '../../lib/finance/proving/demo-blueprint'
import { createInMemoryProvingService, seedSnapshotDigest } from '../../lib/finance/proving/service'
import type { FinanceActorContext } from '../../lib/finance/types'

const actor: FinanceActorContext = {
  uid: 'verify-admin',
  orgId: 'org-verify-proving',
  membershipRole: 'owner',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [
    {
      id: 'asg',
      orgId: 'org-verify-proving',
      userId: 'verify-admin',
      legalEntityId: 'any',
      scopeMode: 'entity',
      role: 'finance_admin',
      status: 'active',
    },
  ],
}

function id(k: string) {
  return { requestId: `v-req-${k}`, idempotencyKey: `v-idem-${k}` }
}

async function main() {
  const service = createInMemoryProvingService(() => '2026-08-03T15:00:00.000Z')
  const seed1 = await service.seedDemoCompany(actor, { orgId: actor.orgId, seedKey: PROVING_SEED_KEY, ...id('seed1') })
  const seed2 = await service.seedDemoCompany(actor, { orgId: actor.orgId, seedKey: PROVING_SEED_KEY, ...id('seed2') })
  if (!seed2.idempotentReplay) throw new Error('seed not idempotent')
  if (seedSnapshotDigest(seed1.seed) !== seedSnapshotDigest(seed2.seed)) throw new Error('seed digest drift')

  const blocked = await service.runCloseFixture(actor, {
    orgId: actor.orgId,
    entityCode: 'OPS',
    periodKey: '2026-07',
    resolveBlockers: false,
    ...id('close-block'),
  })
  if (blocked.closeRun.status !== 'blocked') throw new Error('expected blocked close')

  const closed = await service.runCloseFixture(actor, {
    orgId: actor.orgId,
    entityCode: 'OPS',
    periodKey: '2026-07',
    resolveBlockers: true,
    ...id('close-ok'),
  })
  if (closed.closeRun.status !== 'reports_frozen') throw new Error('expected reports_frozen')
  if (!closed.closeRun.freeze?.trialBalanceHash) throw new Error('missing freeze hash')
  if (closed.closeRun.freeze.externalEgressAllowed !== false) throw new Error('egress gate')

  const packs = await service.packagingDryRun(actor, { orgId: actor.orgId, ...id('packs') })
  if (packs.packs.length < 11) throw new Error('expected packaging kinds')
  for (const p of packs.packs) {
    if (p.sarsSubmissionInitiated || p.externalPaymentInitiated || p.externalEgressAllowed) {
      throw new Error(`hard gate failed for ${p.kind}`)
    }
    if (!p.fileNames.length || p.rowCount < 1) throw new Error(`empty pack ${p.kind}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        entities: seed1.seed.entities.length,
        journals: seed1.seed.journals.length,
        seedDigest: seedSnapshotDigest(seed1.seed),
        closeStatus: closed.closeRun.status,
        freezeHash: closed.closeRun.freeze.trialBalanceHash,
        packCount: packs.packs.length,
        hardGates: seed1.seed.hardGates,
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
