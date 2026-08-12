#!/usr/bin/env tsx
/**
 * Dry-run-first canonical cross-org migration / reconciliation CLI.
 *
 * Task: ub12qgO1AMb3WQeLIPSB
 * Defaults to dry-run. Never runs a destructive production migration.
 * --commit only writes missing canonical rows/fields that preserve access;
 * contradictions are reported and skipped.
 *
 * Usage:
 *   npx tsx scripts/migrate-cross-org-canonical.ts
 *   npx tsx scripts/migrate-cross-org-canonical.ts --fixture path/to/snapshot.json
 *   npx tsx scripts/migrate-cross-org-canonical.ts --fixture path/to/snapshot.json --commit
 *   npx tsx scripts/migrate-cross-org-canonical.ts --help
 *
 * Without --fixture the script emits the empty-plan evidence shape so operators
 * can confirm wiring. Live Firestore hydration is intentionally opt-in via a
 * fixture or a future approved data-source adapter — this task ships the pure
 * planner + evidence contract, not a production data wipe.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyMigrationPlan,
  buildCanonicalMigrationPlan,
  type CanonicalMigrationSnapshot,
  type MigrationMode,
  type MigrationOperation,
} from '../lib/cross-org/migration'

export interface CliFlags {
  mode: MigrationMode
  fixturePath?: string
  outDir: string
  help: boolean
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    mode: 'dry-run',
    outDir: resolve(process.cwd(), 'tmp/cross-org-migration'),
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit') flags.mode = 'apply'
    else if (arg === '--dry-run') flags.mode = 'dry-run'
    else if (arg === '--fixture') flags.fixturePath = argv[++i]
    else if (arg === '--out-dir') flags.outDir = resolve(process.cwd(), argv[++i] ?? 'tmp/cross-org-migration')
    else if (arg === '--help' || arg === '-h') flags.help = true
  }
  return flags
}

export function loadSnapshot(fixturePath?: string): CanonicalMigrationSnapshot {
  if (!fixturePath) {
    return {
      relationships: [],
      shares: [],
      existingLinks: [],
      existingGrants: [],
      existingIdentityLinks: [],
      existingAgreements: [],
      resources: [],
      crmIdentityRows: [],
    }
  }
  const abs = resolve(process.cwd(), fixturePath)
  if (!existsSync(abs)) {
    throw new Error(`fixture not found: ${abs}`)
  }
  const raw = JSON.parse(readFileSync(abs, 'utf8')) as CanonicalMigrationSnapshot
  return {
    relationships: raw.relationships ?? [],
    shares: raw.shares ?? [],
    existingLinks: raw.existingLinks ?? [],
    existingGrants: raw.existingGrants ?? [],
    existingIdentityLinks: raw.existingIdentityLinks ?? [],
    existingAgreements: raw.existingAgreements ?? [],
    resources: raw.resources ?? [],
    crmIdentityRows: raw.crmIdentityRows ?? [],
    orphanModuleRecords: raw.orphanModuleRecords,
    orphanTrigger: raw.orphanTrigger,
  }
}

export function writeEvidenceFiles(input: {
  outDir: string
  plan: ReturnType<typeof buildCanonicalMigrationPlan>
  result: Awaited<ReturnType<typeof applyMigrationPlan>>
}): { planPath: string; evidencePath: string; contradictionsPath: string } {
  mkdirSync(input.outDir, { recursive: true })
  const stamp = input.plan.runId
  const planPath = resolve(input.outDir, `${stamp}.plan.json`)
  const evidencePath = resolve(input.outDir, `${stamp}.evidence.json`)
  const contradictionsPath = resolve(input.outDir, `${stamp}.contradictions.json`)
  writeFileSync(planPath, JSON.stringify(input.plan, null, 2))
  writeFileSync(evidencePath, JSON.stringify(input.result.evidence, null, 2))
  writeFileSync(contradictionsPath, JSON.stringify(input.plan.contradictions, null, 2))
  return { planPath, evidencePath, contradictionsPath }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.help) {
    process.stdout.write(
      [
        'migrate-cross-org-canonical.ts',
        '  --dry-run (default)   plan only; write evidence files; no mutations',
        '  --commit              apply planned non-contradiction ops via no-op writer stub',
        '  --fixture <path>      JSON CanonicalMigrationSnapshot',
        '  --out-dir <path>      evidence output directory',
        '',
        'Hard gates: no production destructive migration; contradictions never silent-merge;',
        'legacy aliases remain read-only compatibility inputs.',
        '',
      ].join('\n'),
    )
    return
  }

  const snapshot = loadSnapshot(flags.fixturePath)
  const plan = buildCanonicalMigrationPlan(snapshot, { mode: flags.mode })

  // This CLI ships planner + evidence only. The write hook is a stub that
  // records intended writes without touching Firestore unless a future approved
  // adapter replaces it. --commit still refuses destructive ops.
  const intendedWrites: MigrationOperation[] = []
  const result = await applyMigrationPlan(plan, {
    mode: flags.mode,
    write: async (op) => {
      if (op.destructive) {
        throw new Error(`refusing destructive migration op ${op.id}`)
      }
      intendedWrites.push(op)
    },
  })

  const paths = writeEvidenceFiles({ outDir: flags.outDir, plan, result })

  const report = {
    mode: result.mode,
    destructive: false,
    summary: plan.summary,
    contradictions: plan.contradictions.length,
    intendedWrites: intendedWrites.length,
    evidence: result.evidence,
    paths,
    note:
      flags.mode === 'dry-run'
        ? 'Dry-run complete. Review plan/evidence/contradictions before any apply.'
        : 'Apply mode used planner stub writer only (no Firestore mutations in this task).',
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
