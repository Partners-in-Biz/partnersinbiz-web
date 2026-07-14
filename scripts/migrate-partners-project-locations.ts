#!/usr/bin/env tsx
/**
 * First-class Partners project-location migration.
 *
 * This command is intentionally dry-run by default. Apply requires the exact
 * immutable run id printed by a fresh dry-run. Legacy vps/local dispatch
 * targets are preflight evidence only and are never changed by this script.
 *
 * Usage:
 *   npx tsx scripts/migrate-partners-project-locations.ts
 *   npx tsx scripts/migrate-partners-project-locations.ts --dry-run
 *   npx tsx scripts/migrate-partners-project-locations.ts --apply --confirm-run-id <64-char-run-id>
 */
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { runPartnersProjectLocationMigration } from '@/lib/project-locations/migration'
import {
  createPartnersProjectLocationFirestoreDependencies,
  type ProjectLocationMigrationFirestore,
} from '@/lib/project-locations/migration-firestore'

const PEET_OWNER_USER_ID = 'zcpAJ4NXWQfjXWPXkl6nYwt7Gmm1'

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true })
  const [{ adminDb }, { FieldValue }] = await Promise.all([
    import('@/lib/firebase/admin'),
    import('firebase-admin/firestore'),
  ])
  const dependencies = createPartnersProjectLocationFirestoreDependencies(
    adminDb as unknown as ProjectLocationMigrationFirestore,
    PEET_OWNER_USER_ID,
    () => FieldValue.serverTimestamp(),
  )
  const output = await runPartnersProjectLocationMigration(process.argv.slice(2), dependencies)
  console.log(JSON.stringify({
    runId: output.plan.runId,
    preflight: output.plan.preflight,
    result: output.result,
  }, null, 2))
  if (output.result.mode === 'dry-run') {
    console.log('\nNo writes performed. To apply this exact plan:')
    console.log(`npx tsx scripts/migrate-partners-project-locations.ts --apply --confirm-run-id ${output.plan.runId}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Project-location migration failed')
  process.exitCode = 1
})
