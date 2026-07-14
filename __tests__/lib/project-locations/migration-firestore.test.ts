import { createPartnersProjectLocationFirestoreDependencies } from '@/lib/project-locations/migration-firestore'
import type { ProjectExecutionLocation, ProjectLocationReplica } from '@/lib/project-locations/model'
import { runtimeTargetTransportIdentity } from '@/lib/agents/runtime-targets'

type Row = Record<string, unknown>

function fakeFirestore(seed: Record<string, Record<string, Row>>) {
  const writes: Array<{ collection: string; id: string; operation: string }> = []
  return {
    writes,
    db: {
      collection(name: string) {
        const rows = seed[name] ?? {}
        return {
          doc(id: string) {
            return {
              get: async () => ({ id, exists: Boolean(rows[id]), data: () => rows[id] }),
              create: async () => { writes.push({ collection: name, id, operation: 'create' }) },
              set: async () => { writes.push({ collection: name, id, operation: 'set' }) },
            }
          },
          get: async () => ({ docs: Object.entries(rows).map(([id, data]) => ({ id, exists: true, data: () => data })) }),
          where(field: string, op: string, value: unknown) {
            return {
              get: async () => ({
                docs: Object.entries(rows).filter(([, data]) => (
                  op === 'array-contains' ? Array.isArray(data[field]) && data[field].includes(value) : data[field] === value
                )).map(([id, data]) => ({ id, exists: true, data: () => data })),
              }),
            }
          },
        }
      },
    },
  }
}

describe('Partners project-location Firestore migration adapter', () => {
  it('loads org, Workspace, human membership, legacy transports, and every project link shape', async () => {
    const { db } = fakeFirestore({
      organizations: { 'pib-platform-owner': { active: true } },
      org_workspaces: { partners: { orgId: 'pib-platform-owner', status: 'active' } },
      users: { peet: { role: 'admin', displayName: 'Peet Stander' } },
      orgMembers: { 'pib-platform-owner_peet': { role: 'owner', status: 'active' } },
      agent_dispatch_configs: {
        pip: { runtimeTargets: {
          vps: { id: 'vps', baseUrl: 'https://vps.example.test' },
          local: { id: 'local', baseUrl: 'https://mac.example.test', hostId: 'peets-mac' },
        } },
      },
      projects: {
        owned: { orgId: 'pib-platform-owner' },
        client: { clientOrgId: 'pib-platform-owner' },
        multi: { linkedOrgIds: ['pib-platform-owner', 'another-org'] },
      },
    })
    const dependencies = createPartnersProjectLocationFirestoreDependencies(db as never, 'peet', () => 'now')
    const preflight = await dependencies.loadPreflight()
    expect(preflight.membership).toEqual(expect.objectContaining({
      exists: true, orgId: 'pib-platform-owner', userId: 'peet', role: 'owner', status: 'active',
    }))
    expect(preflight.legacyRuntimeTargetIds).toEqual(['local', 'vps'])
    expect(preflight.legacyRuntimeTargetIdentities).toEqual({
      vps: runtimeTargetTransportIdentity({ baseUrl: 'https://vps.example.test' }),
      local: runtimeTargetTransportIdentity({ baseUrl: 'https://mac.example.test', hostId: 'peets-mac' }),
    })
    expect(preflight.projects.map((project) => project.id)).toEqual(['client', 'multi', 'owned'])
  })

  it('writes only first-class location, replica, and audit collections', async () => {
    const { db, writes } = fakeFirestore({})
    const dependencies = createPartnersProjectLocationFirestoreDependencies(db as never, 'peet', () => 'now')
    await dependencies.repository.createLocation({ locationId: 'location-a' } as ProjectExecutionLocation)
    await dependencies.repository.patchLocationTransportIdentity('location-a', 'transport-a')
    await dependencies.repository.createReplica({ replicaId: 'replica-a' } as ProjectLocationReplica)
    await dependencies.repository.writeAudit('run-a', { status: 'running' })
    expect(writes).toEqual([
      { collection: 'project_execution_locations', id: 'location-a', operation: 'create' },
      { collection: 'project_execution_locations', id: 'location-a', operation: 'set' },
      { collection: 'project_location_replicas', id: 'replica-a', operation: 'create' },
      { collection: 'project_location_migration_runs', id: 'run-a', operation: 'set' },
    ])
    expect(writes.some((write) => write.collection === 'agent_dispatch_configs')).toBe(false)
  })
})
