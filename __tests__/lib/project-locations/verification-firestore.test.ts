import {
  createProjectLocationVerificationFirestoreRepository,
  type ProjectLocationVerificationFirestore,
} from '@/lib/project-locations/verification-firestore'

type Row = Record<string, unknown>

function fakeFirestore(seed: Record<string, Record<string, Row>>) {
  const writes: Array<{ collection: string; id: string; data: Row; merge: boolean; batched: boolean }> = []
  const db: ProjectLocationVerificationFirestore = {
    batch() {
      const pending: Array<{ collection: string; id: string; data: Row; merge: boolean; batched: boolean }> = []
      return {
        set(reference, data, options) {
          pending.push({ collection: reference.collectionName, id: reference.id, data, merge: options?.merge === true, batched: true })
          return this
        },
        commit: async () => { writes.push(...pending) },
      }
    },
    collection(name) {
      const rows = seed[name] ?? {}
      return {
        doc(id) {
          return {
            get: async () => ({ id, exists: Boolean(rows[id]), data: () => rows[id] }),
            collectionName: name,
            id,
            set: async (data, options) => { writes.push({ collection: name, id, data, merge: options?.merge === true, batched: false }) },
          }
        },
        where(field, _operation, value) {
          return {
            get: async () => ({
              docs: Object.entries(rows).filter(([, row]) => row[field] === value)
                .map(([id, data]) => ({ id, exists: true, data: () => data })),
            }),
          }
        },
      }
    },
  }
  return { db, writes }
}

describe('project-location verification Firestore repository', () => {
  it('loads only active replicas for the requested location', async () => {
    const { db } = fakeFirestore({
      project_execution_locations: { 'partners-vps': { locationId: 'partners-vps' } },
      project_location_replicas: {
        one: { replicaId: 'one', locationId: 'partners-vps', active: true },
        removed: { replicaId: 'removed', locationId: 'partners-vps', active: false },
        other: { replicaId: 'other', locationId: 'peets-mac-mini', active: true },
      },
    })
    const repository = createProjectLocationVerificationFirestoreRepository(db)
    expect((await repository.getLocation('partners-vps'))?.locationId).toBe('partners-vps')
    expect((await repository.listActiveReplicas('partners-vps')).map((row) => row.replicaId)).toEqual(['one'])
  })

  it('writes only merge patches and sanitized audit records to verification-owned collections', async () => {
    const { db, writes } = fakeFirestore({})
    const repository = createProjectLocationVerificationFirestoreRepository(db)
    await repository.commitVerification({
      updates: [{
        locationId: 'partners-vps',
        locationPatch: { availability: 'online' },
        replicas: [{ replicaId: 'replica-one', patch: { availability: 'online' } }],
      }],
      completedAudit: { runId: 'a'.repeat(64), status: 'completed' },
    })
    await repository.writeAudit('a'.repeat(64), { status: 'completed' })
    expect(writes).toEqual([
      { collection: 'project_execution_locations', id: 'partners-vps', data: { availability: 'online' }, merge: true, batched: true },
      { collection: 'project_location_replicas', id: 'replica-one', data: { availability: 'online' }, merge: true, batched: true },
      { collection: 'project_location_verification_runs', id: 'a'.repeat(64), data: { runId: 'a'.repeat(64), status: 'completed' }, merge: true, batched: true },
      { collection: 'project_location_verification_runs', id: 'a'.repeat(64), data: { status: 'completed' }, merge: true, batched: false },
    ])
  })
})
