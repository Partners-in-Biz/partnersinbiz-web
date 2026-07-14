#!/usr/bin/env tsx
/**
 * Verify the two migrated Partners execution locations.
 *
 * Dry-run is the default. Apply requires the exact immutable run id printed by
 * a fresh successful dry-run. The command records only sanitized evidence;
 * runtime credentials, endpoints, SSH hosts, and filesystem paths are omitted.
 *
 * Required environment:
 *   PIB_VPS_HOST=<authoritative SSH host>
 * Optional:
 *   PIB_VPS_USER=root
 *
 * Usage:
 *   PIB_VPS_HOST=<host> npx tsx scripts/verify-partners-project-locations.ts
 *   PIB_VPS_HOST=<host> npx tsx scripts/verify-partners-project-locations.ts --apply --confirm-run-id <run-id>
 */
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { config } from 'dotenv'
import { callAgentPath } from '@/lib/agents/team'
import {
  runPartnersLocationVerification,
  DEFAULT_PEET_OWNER_USER_ID,
} from '@/lib/project-locations/verification'
import {
  createProjectLocationVerificationFirestoreRepository,
  type ProjectLocationVerificationFirestore,
} from '@/lib/project-locations/verification-firestore'
import { inspectLocalWorkspaceProjectFolders } from '@/lib/project-locations/verification-probes'
import { createPartnersLocationEvidenceProbe } from '@/lib/project-locations/verification-runtime-probe'
import {
  parsePartnersVerificationSshConfig,
  runRemoteWorkspaceFolderProbe,
} from '@/lib/project-locations/verification-ssh'

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true })
  const ssh = parsePartnersVerificationSshConfig(process.env)
  const [{ adminDb }, { FieldValue }] = await Promise.all([
    import('@/lib/firebase/admin'),
    import('firebase-admin/firestore'),
  ])
  const repository = createProjectLocationVerificationFirestoreRepository(
    adminDb as unknown as ProjectLocationVerificationFirestore,
  )
  const probe = createPartnersLocationEvidenceProbe({
    async runtimeHealth(runtimeTargetId) {
      const startedAt = performance.now()
      const { response } = await callAgentPath('pip', '/v1/health', { method: 'GET' }, { runtimeTarget: runtimeTargetId })
      return { statusCode: response.status, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) }
    },
    remoteFolders: (input) => runRemoteWorkspaceFolderProbe(input, ssh),
    localFolders: inspectLocalWorkspaceProjectFolders,
    now: () => new Date(),
  })
  const output = await runPartnersLocationVerification(process.argv.slice(2), {
    repository,
    probe,
    ownerUserId: DEFAULT_PEET_OWNER_USER_ID,
    now: () => new Date(),
    databaseTimestamp: () => FieldValue.serverTimestamp(),
  })
  console.log(JSON.stringify({
    runId: output.plan.runId,
    locationIds: output.plan.locationIds,
    evidence: output.plan.evidence,
    result: output.result,
  }, null, 2))
  if (output.result.mode === 'dry-run') {
    console.log('\nNo writes performed. After reviewing this exact fresh proof, apply with:')
    console.log(`PIB_VPS_HOST=<host> npx tsx scripts/verify-partners-project-locations.ts --apply --confirm-run-id ${output.plan.runId}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Project-location verification failed')
  process.exitCode = 1
})
