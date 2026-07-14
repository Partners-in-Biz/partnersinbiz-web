import { buildProjectContentManifest, type ProjectSyncWorkerBinding } from '@/lib/project-sync/model'
import { type ProjectSyncRuntimeJob } from '@/lib/project-sync/runtime-jobs'
import {
  DEFAULT_PROJECT_SYNC_RUNTIME_LEASE_MS,
  PROJECT_SYNC_RUNTIME_JOB_RETENTION_MS,
  createProjectSyncRuntimeRepository,
} from '@/lib/project-sync/runtime-store'

type Row = Record<string, unknown>

function fakeFirestore() {
  const rows = new Map<string, Map<string, Row>>()
  const table = (name: string) => {
    let value = rows.get(name)
    if (!value) { value = new Map(); rows.set(name, value) }
    return value
  }
  const snapshot = (name: string, id: string) => ({
    exists: table(name).has(id),
    id,
    data: () => table(name).get(id),
  })
  const reference = (name: string, id: string) => ({
    id,
    _name: name,
    get: async () => snapshot(name, id),
    set: async (data: Row, options?: { merge?: boolean }) => {
      table(name).set(id, options?.merge ? { ...(table(name).get(id) ?? {}), ...data } : { ...data })
    },
  })
  const collection = (name: string) => ({
    doc: (id: string) => reference(name, id),
    where: () => ({ where: () => null, get: async () => ({ docs: [] }) }),
    get: async () => ({ docs: [] }),
  })
  const db = {
    collection,
    runTransaction: async <T>(work: (transaction: {
      get(ref: ReturnType<typeof reference>): Promise<ReturnType<typeof snapshot>>
      set(ref: ReturnType<typeof reference>, data: Row, options?: { merge?: boolean }): void
    }) => Promise<T>) => work({
      get: (ref) => ref.get(),
      set: (ref, data, options) => {
        table(ref._name).set(ref.id, options?.merge ? { ...(table(ref._name).get(ref.id) ?? {}), ...data } : { ...data })
      },
    }),
    batch: () => {
      const pending: Array<() => void> = []
      return {
        set: (ref: ReturnType<typeof reference>, data: Row, options?: { merge?: boolean }) => pending.push(() => {
          table(ref._name).set(ref.id, options?.merge ? { ...(table(ref._name).get(ref.id) ?? {}), ...data } : { ...data })
        }),
        commit: async () => { pending.forEach((write) => write()) },
      }
    },
  }
  return { db, rows, table }
}

const binding: ProjectSyncWorkerBinding = {
  capability: 'workspace.sync',
  requestId: 'request-a',
  orgId: 'org-a',
  projectId: 'project-a',
  replicaId: 'replica-a',
  locationId: 'linked-device:device-a',
  mappingId: 'mapping-a',
}

function inventoryJob(overrides: Partial<Extract<ProjectSyncRuntimeJob, { kind: 'inventory' }>> = {}): Extract<ProjectSyncRuntimeJob, { kind: 'inventory' }> {
  return {
    jobId: 'job-a', kind: 'inventory', binding, recurring: false, baselineRevision: null,
    bootstrapMissingRoot: false, ...overrides,
  }
}

describe('project sync runtime Firestore repository', () => {
  it('persists bounded source-revision CAS progress and advances it transactionally and idempotently', async () => {
    const { db, table } = fakeFirestore()
    const repository = createProjectSyncRuntimeRepository(db as never)
    const manifest = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'a.txt', sha256: 'a'.repeat(64), size: 1 },
      { type: 'file', path: 'a-copy.txt', sha256: 'a'.repeat(64), size: 1 },
      { type: 'file', path: 'b.txt', sha256: 'b'.repeat(64), size: 2 },
    ] })
    const initial = await repository.ensureCasReadiness({ orgId: 'org-a', projectId: 'project-a', manifest, now: '2026-07-14T08:00:00.000Z' })
    expect(initial).toEqual({ revision: manifest.revision, objectCount: 2, verifiedObjectCount: 0, ready: false })
    expect(table('project_sync_cas_readiness').size).toBe(1)

    const first = await repository.advanceCasReadiness({
      orgId: 'org-a', projectId: 'project-a', revision: manifest.revision, objectCount: 2,
      expectedVerifiedObjectCount: 0, verifiedObjectCount: 1, now: '2026-07-14T08:01:00.000Z',
    })
    expect(first.ready).toBe(false)
    await expect(repository.advanceCasReadiness({
      orgId: 'org-a', projectId: 'project-a', revision: manifest.revision, objectCount: 2,
      expectedVerifiedObjectCount: 0, verifiedObjectCount: 1, now: '2026-07-14T08:01:01.000Z',
    })).resolves.toEqual(first)
    await expect(repository.advanceCasReadiness({
      orgId: 'org-a', projectId: 'project-a', revision: manifest.revision, objectCount: 2,
      expectedVerifiedObjectCount: 0, verifiedObjectCount: 2, now: '2026-07-14T08:01:02.000Z',
    })).rejects.toThrow(/readiness changed/i)
    await expect(repository.advanceCasReadiness({
      orgId: 'org-a', projectId: 'project-a', revision: manifest.revision, objectCount: 2,
      expectedVerifiedObjectCount: 1, verifiedObjectCount: 2, now: '2026-07-14T08:02:00.000Z',
    })).resolves.toEqual(expect.objectContaining({ verifiedObjectCount: 2, ready: true }))
  })

  it('keeps an immutable exact lease contract across takeover, completion, and replay', async () => {
    const { db, table } = fakeFirestore()
    const repository = createProjectSyncRuntimeRepository(db as never)
    const now = '2026-07-14T08:00:00.000Z'
    const job = inventoryJob()
    await expect(repository.tryLease({ job, binding, deviceId: 'device-a', credentialVersion: 2, now })).resolves.toBe(true)
    const stored = [...table('project_sync_runtime_jobs').values()][0]
    expect((stored.leaseExpiresAt as { toMillis(): number }).toMillis() - Date.parse(now)).toBe(DEFAULT_PROJECT_SYNC_RUNTIME_LEASE_MS)
    expect((stored.expiresAt as { toMillis(): number }).toMillis() - Date.parse(now)).toBe(PROJECT_SYNC_RUNTIME_JOB_RETENTION_MS)
    await expect(repository.tryLease({ job, binding, deviceId: 'device-a', credentialVersion: 2, now })).resolves.toBe(false)
    await expect(repository.tryLease({
      job: inventoryJob({ recurring: true }), binding, deviceId: 'device-a', credentialVersion: 2,
      now: '2026-07-15T08:00:00.000Z',
    })).rejects.toThrow(/lease contract mismatch/i)
    await expect(repository.tryLease({
      job, binding, deviceId: 'device-a', credentialVersion: 3, now: '2026-07-15T08:00:00.000Z',
    })).resolves.toBe(true)

    const lease = await repository.getLease(job.jobId)
    expect(lease).toEqual(expect.objectContaining({ jobKind: 'inventory', binding, credentialVersion: 3, status: 'leased' }))
    await expect(repository.completeLease({
      jobId: job.jobId, identity: { deviceId: 'other-device', credentialVersion: 3 }, binding,
      jobKind: 'inventory', payloadHash: lease!.payloadHash,
    })).rejects.toThrow(/completion mismatch/i)
    const completion = {
      jobId: job.jobId, identity: { deviceId: 'device-a', credentialVersion: 4 }, binding,
      jobKind: 'inventory' as const, payloadHash: lease!.payloadHash,
    }
    await expect(repository.completeLease(completion)).resolves.toBeUndefined()
    await expect(repository.completeLease(completion)).resolves.toBeUndefined()
    await expect(repository.tryLease({
      job, binding, deviceId: 'device-a', credentialVersion: 4, now: '2026-07-16T08:00:00.000Z',
    })).resolves.toBe(false)
  })

  it('fails closed when a stored runtime lease row is malformed', async () => {
    const { db, table } = fakeFirestore()
    const repository = createProjectSyncRuntimeRepository(db as never)
    const job = inventoryJob()
    await repository.tryLease({ job, binding, deviceId: 'device-a', credentialVersion: 2, now: '2026-07-14T08:00:00.000Z' })
    const [id, row] = [...table('project_sync_runtime_jobs').entries()][0]
    table('project_sync_runtime_jobs').set(id, { ...row, payload: null })
    await expect(repository.getLease(job.jobId)).resolves.toBeNull()
    await expect(repository.completeLease({
      jobId: job.jobId, identity: { deviceId: 'device-a', credentialVersion: 2 }, binding,
      jobKind: 'inventory', payloadHash: String(row.payloadHash),
    })).rejects.toThrow(/completion mismatch|not active/i)
  })

  it('releases an exact retryable lease for immediate same-device reclaim after rotation', async () => {
    const { db } = fakeFirestore()
    const repository = createProjectSyncRuntimeRepository(db as never)
    const job = inventoryJob()
    await repository.tryLease({ job, binding, deviceId: 'device-a', credentialVersion: 2, now: '2026-07-14T08:00:00.000Z' })
    const lease = await repository.getLease(job.jobId)
    await expect(repository.releaseLease({
      jobId: job.jobId,
      identity: { deviceId: 'device-a', credentialVersion: 3 },
      binding,
      jobKind: 'inventory',
      payloadHash: lease!.payloadHash,
      now: '2026-07-14T08:01:00.000Z',
    })).resolves.toBeUndefined()
    await expect(repository.tryLease({
      job, binding, deviceId: 'device-a', credentialVersion: 3, now: '2026-07-14T08:01:01.000Z',
    })).resolves.toBe(true)
  })
})
