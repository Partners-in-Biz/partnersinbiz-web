import {
  createPartnersLocationEvidenceProbe,
  PARTNERS_LOCAL_WORKSPACE_ROOT,
  PARTNERS_VPS_WORKSPACE_ROOT,
} from '@/lib/project-locations/verification-runtime-probe'
import { buildPartnersProjectLocationMigrationPlan } from '@/lib/project-locations/migration'

describe('Partners location evidence probe', () => {
  it('uses authenticated health plus SSH for the VPS and local filesystem for Peet\'s Mac', async () => {
    const migration = buildPartnersProjectLocationMigrationPlan({
      projectIds: ['project-a'], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: { vps: 'transport-vps', local: 'transport-local' }, now: 'now',
    })
    const calls: Array<Record<string, unknown>> = []
    const probe = createPartnersLocationEvidenceProbe({
      runtimeHealth: async (runtimeTargetId) => {
        calls.push({ kind: 'health', runtimeTargetId })
        return { statusCode: 200, latencyMs: 10 }
      },
      remoteFolders: async (input) => {
        calls.push({ kind: 'remote', root: input.workspaceRoot })
        return { workspaceRootMatches: true, projectFolderIds: ['project-a'], nonEmptyProjectFolderCount: 0 }
      },
      localFolders: async (input) => {
        calls.push({ kind: 'local', root: input.workspaceRoot })
        return { workspaceRootMatches: true, projectFolderIds: ['project-a'], nonEmptyProjectFolderCount: 0 }
      },
      now: () => new Date('2026-07-13T20:00:00.000Z'),
    })
    const vps = await probe(migration.locations[0], migration.replicas.filter((row) => row.locationId === 'partners-vps'))
    const mac = await probe(migration.locations[1], migration.replicas.filter((row) => row.locationId === 'peets-mac-mini'))
    expect(vps).toEqual(expect.objectContaining({
      locationId: 'partners-vps', checkedAt: '2026-07-13T20:00:00.000Z',
      runtimeHealth: { statusCode: 200, latencyMs: 10, probe: 'authenticated-runtime-health' },
      folders: expect.objectContaining({ probe: 'ssh-filesystem' }),
    }))
    expect(mac.folders.probe).toBe('local-filesystem')
    expect(calls).toEqual([
      { kind: 'health', runtimeTargetId: 'vps' },
      { kind: 'remote', root: PARTNERS_VPS_WORKSPACE_ROOT },
      { kind: 'health', runtimeTargetId: 'local' },
      { kind: 'local', root: PARTNERS_LOCAL_WORKSPACE_ROOT },
    ])
    expect(JSON.stringify([vps, mac])).not.toContain(PARTNERS_VPS_WORKSPACE_ROOT)
    expect(JSON.stringify([vps, mac])).not.toContain(PARTNERS_LOCAL_WORKSPACE_ROOT)
  })

  it('sanitizes lower-level probe errors', async () => {
    const migration = buildPartnersProjectLocationMigrationPlan({
      projectIds: ['project-a'], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: { vps: 'transport-vps', local: 'transport-local' }, now: 'now',
    })
    const probe = createPartnersLocationEvidenceProbe({
      runtimeHealth: async () => { throw new Error('secret=https://host/?key=credential') },
      remoteFolders: async () => ({ workspaceRootMatches: true, projectFolderIds: [], nonEmptyProjectFolderCount: 0 }),
      localFolders: async () => ({ workspaceRootMatches: true, projectFolderIds: [], nonEmptyProjectFolderCount: 0 }),
      now: () => new Date(),
    })
    await expect(probe(migration.locations[0], migration.replicas)).rejects.toThrow('partners-vps runtime health probe failed')
    await expect(probe(migration.locations[0], migration.replicas)).rejects.not.toThrow('credential')
  })
})
