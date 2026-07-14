import indexesConfig from '@/firestore.indexes.json'
import storageLifecycle from '@/config/project-sync-storage-lifecycle-rule.json'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PROJECT_SYNC_TTL_COLLECTIONS = [
  'project_sync_manifest_chunks',
  'project_sync_manifest_heads',
  'project_sync_cas_readiness',
  'project_sync_objects',
  'project_sync_runtime_jobs',
]

describe('project sync bounded-retention deployment config', () => {
  it('declares an expiresAt TTL for every ephemeral project-sync Firestore collection', () => {
    for (const collectionGroup of PROJECT_SYNC_TTL_COLLECTIONS) {
      expect(indexesConfig.fieldOverrides).toContainEqual({
        collectionGroup,
        fieldPath: 'expiresAt',
        ttl: true,
        indexes: [],
      })
    }
  })

  it('defines the required customTime-based Storage CAS deletion rule', () => {
    expect(storageLifecycle).toEqual({
      rule: [{
        action: { type: 'Delete' },
        condition: { daysSinceCustomTime: 35, matchesPrefix: ['project-sync/'] },
      }],
    })
  })

  it('allows the compatibility env flag only after live readback of both retention controls', () => {
    const runbook = readFileSync(resolve(process.cwd(), 'docs/deploy/project-replica-sync-v1.md'), 'utf8')
    expect(runbook).toMatch(/PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED=true/)
    expect(runbook).toMatch(/only after live readback of BOTH all five Firestore TTL policies and the Storage lifecycle rule/i)
  })
})
