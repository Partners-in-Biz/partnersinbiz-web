import { cleanupLinkedRuntimeTransports, planLinkedRuntimeTransportCleanup } from '@/scripts/cleanup-linked-runtime-transports'

function fakeDb(seed: Record<string, Record<string, unknown>>, failCommit = -1) {
  const rows = new Map(Object.entries(seed)); let commits = 0
  const ref = (collection: string, id: string) => ({
    id, path: `${collection}/${id}`,
    get: async () => ({ exists: rows.has(`${collection}/${id}`), id, data: () => rows.get(`${collection}/${id}`) }),
    create: async (value: Record<string, unknown>) => { if (rows.has(`${collection}/${id}`)) throw new Error('exists'); rows.set(`${collection}/${id}`, value) },
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => rows.set(`${collection}/${id}`, options?.merge ? { ...rows.get(`${collection}/${id}`), ...value } : value),
  })
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ref(collection, id),
      get: async () => ({ docs: [...rows.entries()].filter(([path]) => path.startsWith(`${collection}/`)).map(([path, data]) => ({ id: path.split('/').at(-1)!, data: () => data })) }),
    }),
    batch: () => {
      const operations: Array<() => void> = []
      return {
        delete: (document: { path: string }) => operations.push(() => rows.delete(document.path)),
        update: (document: { path: string }, value: Record<string, unknown>) => operations.push(() => {
          const next = { ...rows.get(document.path) }; for (const key of Object.keys(value)) delete next[key]; rows.set(document.path, next)
        }),
        create: (document: { path: string }, value: Record<string, unknown>) => operations.push(() => { if (rows.has(document.path)) throw new Error('exists'); rows.set(document.path, value) }),
        set: (document: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => operations.push(() => rows.set(document.path, options?.merge ? { ...rows.get(document.path), ...value } : value)),
        commit: async () => { commits += 1; if (commits === failCommit) throw new Error('forced batch failure'); operations.forEach((operation) => operation()) },
      }
    },
  }
  return { db, rows, disableFailure: () => { failCommit = -1 } }
}

describe('legacy linked runtime transport cleanup', () => {
  it('deletes only legacy transport rows and allowlisted legacy fields without emitting or logging secret values', () => {
    const actions = planLinkedRuntimeTransportCleanup([
      { collection: 'linked_device_runtime_transports', id: 'device-a', data: { encryptedOutboundToken: 'secret', endpoint: 'https://legacy' } },
      { collection: 'linked_devices', id: 'device-a', data: { label: 'Mac', runtimeEndpoint: 'https://legacy', transportToken: 'secret' } },
      { collection: 'linked_device_credentials', id: 'device-a', data: { credentialHash: 'keep', encryptedTransportToken: { ciphertext: 'secret' } } },
      { collection: 'linked_device_rotation_deliveries', id: 'device-a', data: { encryptedCredential: 'keep', credentialVersion: 2 } },
      { collection: 'unrelated', id: 'x', data: { transportToken: 'leave' } },
    ])
    expect(actions).toEqual([
      { collection: 'linked_device_runtime_transports', id: 'device-a', kind: 'delete-document', fields: [] },
      { collection: 'linked_devices', id: 'device-a', kind: 'delete-fields', fields: ['runtimeEndpoint', 'transportToken'] },
      { collection: 'linked_device_credentials', id: 'device-a', kind: 'delete-fields', fields: ['encryptedTransportToken'] },
    ])
    expect(JSON.stringify(actions)).not.toMatch(/https:\/\/legacy|secret|credentialHash|encryptedCredential/)
  })

  it('is idempotent after legacy rows and fields are absent', () => {
    expect(planLinkedRuntimeTransportCleanup([
      { collection: 'linked_devices', id: 'device-a', data: { label: 'Mac' } },
      { collection: 'linked_device_credentials', id: 'device-a', data: { credentialHash: 'keep' } },
    ])).toEqual([])
  })

  it('atomically checkpoints each apply batch and records a recoverable failed run', async () => {
    const state = fakeDb({
      'linked_device_runtime_transports/device-a': { encryptedOutboundToken: 'secret-a' },
      'linked_devices/device-a': { label: 'Mac', runtimeEndpoint: 'secret-b' },
    }, 2)
    await expect(cleanupLinkedRuntimeTransports({ apply: true, runId: 'run-partial-1', db: state.db as never, batchSize: 1 }))
      .rejects.toThrow('forced batch failure')
    expect(state.rows.has('linked_device_runtime_transports/device-a')).toBe(false)
    expect(state.rows.get('linked_devices/device-a')).toHaveProperty('runtimeEndpoint')
    expect(state.rows.get('linked_computer_migration_runs/run-partial-1')).toMatchObject({
      status: 'failed', batchIndex: 1, completed: { transportDocuments: 1, documentsWithLegacyFields: 0, legacyFields: 0 },
    })
    expect(state.rows.get('linked_computer_audit_events/run-partial-1_1')).toMatchObject({ batchIndex: 1 })
    expect(JSON.stringify([...state.rows.entries()].filter(([path]) => path.includes('migration_runs/') || path.includes('audit_events/'))))
      .not.toMatch(/secret-a|secret-b/)

    state.disableFailure()
    await expect(cleanupLinkedRuntimeTransports({ apply: true, runId: 'run-partial-1', db: state.db as never, batchSize: 1 }))
      .resolves.toMatchObject({ runId: 'run-partial-1', status: 'complete' })
    expect(state.rows.get('linked_devices/device-a')).not.toHaveProperty('runtimeEndpoint')
    expect(state.rows.get('linked_computer_migration_runs/run-partial-1')).toMatchObject({
      status: 'complete', batchIndex: 2, completed: { transportDocuments: 1, documentsWithLegacyFields: 1, legacyFields: 1 },
    })
    expect(state.rows.get('linked_computer_audit_events/run-partial-1_2')).toMatchObject({ batchIndex: 2 })
  })
})
