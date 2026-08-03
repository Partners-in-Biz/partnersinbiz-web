/**
 * Finance proving kit verify — seed + multi-month close program + packaging + acceptance pack.
 * No SARS submit, no payment initiate, no external egress.
 * Admin/dev seed reset is exercised in-memory only.
 */
import { ALL_PACKAGING_KINDS } from '../../lib/finance/packaging/service'
import {
  MULTI_MONTH_PROGRAM_KEY,
  PROVING_SEED_KEY,
} from '../../lib/finance/proving/demo-blueprint'
import { createInMemoryProvingService, seedSnapshotDigest } from '../../lib/finance/proving/service'
import type { FinanceActorContext } from '../../lib/finance/types'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

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
  if ((seeded.seed.icTransactions?.length ?? 0) < 3) throw new Error('expected IC fixture rows')
  if (seeded.seed.payrollRuns.length < 6) throw new Error('expected multi-month payroll')

  const blocked = await svc.runCloseFixture(a, {
    orgId: 'org_verify_proving',
    entityCode: 'OPS',
    periodKey: '2026-07',
    resolveBlockers: false,
    requestId: 'v3a',
    idempotencyKey: 'v-close-block',
  })
  if (blocked.closeRun.status !== 'blocked') throw new Error('expected blockers before resolve')

  const program = await svc.runMultiMonthCloseProgram(a, {
    orgId: 'org_verify_proving',
    entityCodes: ['OPS', 'SVC'],
    periodKeys: ['2026-05', '2026-06', '2026-07'],
    resolveBlockers: true,
    runPackaging: true,
    requestId: 'v-mm',
    idempotencyKey: 'v-mm',
  })
  if (program.program.programKey !== MULTI_MONTH_PROGRAM_KEY) throw new Error('program key mismatch')
  if (program.program.status !== 'completed') throw new Error(`program not completed: ${program.program.status}`)
  if (program.program.closedPeriodCount < 3) throw new Error('expected ≥3 closed periods')
  if (program.program.closedEntityCount < 2) throw new Error('expected ≥2 closed entities')
  if (program.program.packagingPackCount !== ALL_PACKAGING_KINDS.length) {
    throw new Error(`expected ${ALL_PACKAGING_KINDS.length} packs, got ${program.program.packagingPackCount}`)
  }
  if (program.program.hardGates.externalPaymentInitiated || program.program.hardGates.sarsSubmissionInitiated) {
    throw new Error('program violated hard gates')
  }

  const pack = await svc.exportAcceptancePack(a, {
    orgId: 'org_verify_proving',
    programId: program.program.id,
    requestId: 'v-acc',
    idempotencyKey: 'v-acc',
  })
  if (pack.pack.signOff.wetSignatureProduct !== false) throw new Error('wet signature product must be false')
  if (!pack.pack.markdown.includes('Accountant name')) throw new Error('pack missing sign-off lines')
  if (!pack.pack.contentSha256 || pack.pack.contentSha256.length !== 64) throw new Error('pack hash missing')

  // Deterministic evidence folder write (repo-local artifact; not client email)
  const root = join(process.cwd(), 'artifacts/finance/multi-month-close')
  mkdirSync(join(root, 'seed'), { recursive: true })
  mkdirSync(join(root, 'close-runs'), { recursive: true })
  mkdirSync(join(root, 'packaging'), { recursive: true })
  mkdirSync(join(root, 'acceptance'), { recursive: true })
  writeFileSync(
    join(root, 'seed', 'latest-seed-digest.txt'),
    `${seedSnapshotDigest(seeded.seed)}\n`,
    'utf8',
  )
  writeFileSync(join(root, 'close-runs', 'latest-program.json'), JSON.stringify(program.program, null, 2), 'utf8')
  writeFileSync(join(root, 'acceptance', 'latest-acceptance-pack.md'), pack.pack.markdown, 'utf8')
  writeFileSync(join(root, 'acceptance', 'latest-acceptance-pack.json'), JSON.stringify(pack.pack.json, null, 2), 'utf8')
  writeFileSync(
    join(root, 'HOW-TO-RUN.md'),
    [
      '# Multi-month close program — how to run',
      '',
      '```bash',
      'npm run verify:finance:proving',
      '# or',
      'npx tsx scripts/finance/run-multi-month-close-program.ts',
      '```',
      '',
      'Portal: /portal/finance/proving',
      'Runbooks: /portal/finance/runbooks (P6-M multi-month lane)',
      'Docs: docs/operations/finance/multi-month-close-program-2026-08-03.md',
      'Acceptance pack: docs/operations/finance/phase6-accountant-acceptance-pack-2026-08-03.md',
      '',
      'Hard gates: no SARS submit, no payment initiate, no mass email, development only.',
      '',
    ].join('\n'),
    'utf8',
  )

  // Safe admin reset
  const reset = await svc.resetDemoCompany(a, {
    orgId: 'org_verify_proving',
    confirm: true,
    requestId: 'v-reset',
    idempotencyKey: 'v-reset',
  })
  if (!reset.reset) throw new Error('expected reset')

  console.log(
    JSON.stringify(
      {
        ok: true,
        entities: seeded.seed.entities.length,
        seedKey: seeded.seed.seedKey,
        programKey: program.program.programKey,
        programStatus: program.program.status,
        closedPeriodCount: program.program.closedPeriodCount,
        closedEntityCount: program.program.closedEntityCount,
        freezeHashCount: program.program.evidence.freezeHashes.length,
        packs: program.program.packagingPackCount,
        acceptanceSha: pack.pack.contentSha256.slice(0, 16),
        evidenceRoot: 'artifacts/finance/multi-month-close/',
        hardGates: seeded.seed.hardGates,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        noEgress: true,
        reset: true,
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
