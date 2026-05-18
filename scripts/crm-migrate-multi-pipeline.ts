#!/usr/bin/env tsx
/**
 * One-shot migration: creates a default "Sales" pipeline per org and
 * backfills pipelineId + stageId on every legacy deal (deal.stage → stageId).
 *
 * Idempotent: orgs that already have at least one non-deleted pipeline are
 * skipped.  Deals that already have pipelineId set are skipped.
 *
 * Usage:
 *   npx tsx scripts/crm-migrate-multi-pipeline.ts               # dry-run (default)
 *   npx tsx scripts/crm-migrate-multi-pipeline.ts --dry-run     # explicit dry-run
 *   npx tsx scripts/crm-migrate-multi-pipeline.ts --commit      # actually write
 *   npx tsx scripts/crm-migrate-multi-pipeline.ts --org-id foo  # one org only
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { migrateOrgToDefaultPipeline, type MigrationResult } from '@/lib/pipelines/migration'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

// ── Actor ────────────────────────────────────────────────────────────────────

/** System actor used for all Firestore attribution on migrated docs. */
const MIGRATION_ACTOR: MemberRef = {
  uid: 'system',
  displayName: 'A3 Migration',
  kind: 'agent',
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

interface CliFlags {
  dryRun: boolean
  orgId?: string
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--commit') flags.dryRun = false
    else if (a === '--dry-run') flags.dryRun = true
    else if (a === '--org-id') flags.orgId = argv[++i]
  }
  return flags
}

// ── .env.local loader (mirrors crm-backfill-attribution.ts) ──────────────────

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

// ── Firebase init (mirrors crm-backfill-attribution.ts) ──────────────────────

function initFirebase() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const admin = require('firebase-admin')
  if (admin.apps.length > 0) return admin

  const keyPath = resolve(process.cwd(), 'service-account.json')
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()

  if (existsSync(keyPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) })
  } else if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    })
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() })
  }
  return admin
}

// ── CSV report ────────────────────────────────────────────────────────────────

const CSV_HEADER = 'orgId,pipelineCreated,pipelineId,dealsUpdated,errors\n'

export function buildCsvRow(r: MigrationResult): string {
  const errors = r.errors.map((e) => e.replace(/,/g, ';')).join(' | ')
  return [r.orgId, r.pipelineCreated, r.pipelineId, r.dealsUpdated, errors].join(',')
}

export function writeCsvReport(
  results: MigrationResult[],
  mode: 'dryrun' | 'commit',
  reportDir: string,
): string {
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportPath = resolve(reportDir, `${stamp}-a3-multi-pipeline-${mode}.csv`)
  const body = results.map(buildCsvRow).join('\n')
  writeFileSync(reportPath, CSV_HEADER + body + '\n')
  return reportPath
}

// ── main ──────────────────────────────────────────────────────────────────────

export async function run(flags: CliFlags): Promise<MigrationResult[]> {
  loadEnv()
  const admin = initFirebase()
  const db: FirebaseFirestore.Firestore = admin.firestore()

  let orgQuery: FirebaseFirestore.Query = db.collection('organizations')
  if (flags.orgId) {
    orgQuery = orgQuery.where('__name__', '==', flags.orgId)
  }

  const orgsSnap = await orgQuery.get()
  console.log(
    `\nA3 pipeline migration — mode: ${flags.dryRun ? 'DRY-RUN' : 'COMMIT'} — orgs: ${orgsSnap.size}`,
  )

  const results: MigrationResult[] = []

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id
    process.stdout.write(`  [${orgId}] … `)
    const result = await migrateOrgToDefaultPipeline(orgId, MIGRATION_ACTOR, { dryRun: flags.dryRun })
    results.push(result)
    console.log(
      `pipelineCreated=${result.pipelineCreated} pipelineId=${result.pipelineId} dealsUpdated=${result.dealsUpdated} errors=${result.errors.length}`,
    )
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalDeals = results.reduce((s, r) => s + r.dealsUpdated, 0)
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0)
  const pipelinesCreated = results.filter((r) => r.pipelineCreated).length

  console.log('\n─── Summary ───────────────────────────────────────────')
  console.log(`  Orgs processed:    ${results.length}`)
  console.log(`  Pipelines created: ${pipelinesCreated}`)
  console.log(`  Deals migrated:    ${totalDeals}`)
  console.log(`  Errors:            ${totalErrors}`)

  // ── CSV report ─────────────────────────────────────────────────────────────
  const reportDir = resolve(process.cwd(), 'scripts/crm-backfill-reports')
  const reportPath = writeCsvReport(results, flags.dryRun ? 'dryrun' : 'commit', reportDir)
  console.log(`\nReport: ${reportPath}`)
  console.log(`Mode:   ${flags.dryRun ? 'DRY-RUN (no writes)' : 'COMMITTED'}`)

  return results
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
if (require.main === module) {
  const flags = parseFlags(process.argv.slice(2))
  run(flags).catch((err) => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
