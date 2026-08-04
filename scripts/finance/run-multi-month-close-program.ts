/**
 * Deterministic multi-month close program runner (admin/dev only path).
 * Seeds (or resets+seeds), runs OPS+SVC × 3 periods, packaging dry-run, acceptance pack export.
 * Writes evidence under artifacts/finance/multi-month-close/.
 *
 * Usage:
 *   npx tsx scripts/finance/run-multi-month-close-program.ts
 *   npx tsx scripts/finance/run-multi-month-close-program.ts --reset
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ALL_PACKAGING_KINDS } from '../../lib/finance/packaging/service'
import {
  MULTI_MONTH_PROGRAM_KEY,
  PROVING_SEED_KEY,
} from '../../lib/finance/proving/demo-blueprint'
import { createInMemoryProvingService, seedSnapshotDigest } from '../../lib/finance/proving/service'
import type { FinanceActorContext } from '../../lib/finance/types'

const orgId = process.env.PROVING_ORG_ID || 'org_multi_month_demo'
const wantReset = process.argv.includes('--reset')

function admin(): FinanceActorContext {
  return {
    uid: 'multi-month-runner',
    orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg',
        orgId,
        userId: 'multi-month-runner',
        legalEntityId: 'le',
        scopeMode: 'entity',
        role: 'finance_admin',
        status: 'active',
      },
    ],
  }
}

async function main() {
  const svc = createInMemoryProvingService(() => new Date().toISOString())
  const a = admin()

  if (wantReset) {
    await svc.resetDemoCompany(a, {
      orgId,
      confirm: true,
      requestId: 'runner-reset',
      idempotencyKey: `runner-reset-${Date.now()}`,
    })
  }

  const seeded = await svc.seedDemoCompany(a, {
    orgId,
    seedKey: PROVING_SEED_KEY,
    requestId: 'runner-seed',
    idempotencyKey: wantReset ? `runner-seed-${Date.now()}` : 'runner-seed',
  })

  const program = await svc.runMultiMonthCloseProgram(a, {
    orgId,
    entityCodes: ['OPS', 'SVC'],
    periodKeys: ['2026-05', '2026-06', '2026-07'],
    resolveBlockers: true,
    runPackaging: true,
    requestId: 'runner-mm',
    idempotencyKey: wantReset ? `runner-mm-${Date.now()}` : 'runner-mm',
  })

  const pack = await svc.exportAcceptancePack(a, {
    orgId,
    programId: program.program.id,
    requestId: 'runner-acc',
    idempotencyKey: wantReset ? `runner-acc-${Date.now()}` : 'runner-acc',
  })

  const root = join(process.cwd(), 'artifacts/finance/multi-month-close')
  for (const sub of ['seed', 'close-runs', 'packaging', 'acceptance']) {
    mkdirSync(join(root, sub), { recursive: true })
  }
  writeFileSync(join(root, 'seed', 'latest-seed-digest.txt'), `${seedSnapshotDigest(seeded.seed)}\n`)
  writeFileSync(join(root, 'close-runs', 'latest-program.json'), JSON.stringify(program.program, null, 2))
  writeFileSync(join(root, 'packaging', 'pack-count.txt'), `${program.program.packagingPackCount}\n`)
  writeFileSync(join(root, 'acceptance', 'latest-acceptance-pack.md'), pack.pack.markdown)
  writeFileSync(join(root, 'acceptance', 'latest-acceptance-pack.json'), JSON.stringify(pack.pack.json, null, 2))

  if (program.program.status !== 'completed') {
    console.error(JSON.stringify({ ok: false, program: program.program }, null, 2))
    process.exit(1)
  }
  if (program.program.packagingPackCount !== ALL_PACKAGING_KINDS.length) {
    throw new Error('packaging count mismatch')
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        orgId,
        seedKey: PROVING_SEED_KEY,
        programKey: MULTI_MONTH_PROGRAM_KEY,
        programId: program.program.id,
        closedPeriodCount: program.program.closedPeriodCount,
        closedEntityCount: program.program.closedEntityCount,
        packs: program.program.packagingPackCount,
        acceptanceSha: pack.pack.contentSha256,
        evidenceRoot: 'artifacts/finance/multi-month-close/',
        hardGates: program.program.hardGates,
        gaps: program.program.gaps,
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
