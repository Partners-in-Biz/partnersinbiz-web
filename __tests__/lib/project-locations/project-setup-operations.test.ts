import {
  ProjectSetupIdempotencyError,
  createProjectSetupOperationRepository,
  projectSetupOperationResourceIds,
  projectSetupRequestFingerprint,
  type ProjectSetupOperationFirestore,
} from '@/lib/project-locations/project-setup-operations'
import type { ProjectSetupExecutionResult } from '@/lib/project-locations/project-setup-execution'

type Row = Record<string, unknown>

function fakeFirestore() {
  const rows: Record<string, Record<string, Row>> = {}
  let transactionTail = Promise.resolve()
  const db: ProjectSetupOperationFirestore = {
    collection(collectionName) {
      return { doc: (id) => ({ collectionName, id }) }
    },
    runTransaction(callback) {
      const run = transactionTail.then(() => callback({
        get: async (ref) => ({
          id: ref.id,
          exists: Boolean(rows[ref.collectionName]?.[ref.id]),
          data: () => rows[ref.collectionName]?.[ref.id],
        }),
        create(ref, data) {
          if (rows[ref.collectionName]?.[ref.id]) throw new Error('already exists')
          rows[ref.collectionName] ??= {}
          rows[ref.collectionName][ref.id] = structuredClone(data)
        },
        set(ref, data, options) {
          rows[ref.collectionName] ??= {}
          rows[ref.collectionName][ref.id] = options?.merge
            ? { ...(rows[ref.collectionName][ref.id] ?? {}), ...structuredClone(data) }
            : structuredClone(data)
        },
      }))
      transactionTail = run.then(() => undefined, () => undefined)
      return run
    },
  }
  return { db, rows }
}

function result(state: 'partial' | 'ready'): ProjectSetupExecutionResult {
  return {
    status: state === 'partial' ? 207 : 201,
    projectId: 'project-1',
    project: { id: 'project-1', name: 'Campaign', orgId: 'org-1', workspaceId: 'workspace-1' },
    replicas: [],
    plan: {
      requestId: 'setup_operation', mode: 'standard', state,
      completed: state === 'ready', syncCompleted: state === 'ready', actions: [],
    },
  }
}

describe('project setup operation repository', () => {
  const requestFingerprint = projectSetupRequestFingerprint({
    mode: 'standard', orgId: 'org-1', projectName: 'Campaign', workspaceId: 'workspace-1',
    locationIds: ['vps-1'],
  })

  it('allows only one concurrent caller to claim a caller-bound key', async () => {
    const { db } = fakeFirestore()
    const repository = createProjectSetupOperationRepository(db, { nowMs: () => 1_000 })
    const claim = () => repository.claim({
      actorUserId: 'user-1', idempotencyKey: 'wizard-attempt-123', requestFingerprint,
    })

    const claims = await Promise.all([claim(), claim()])
    expect(claims.filter(candidate => candidate.kind === 'claimed')).toHaveLength(1)
    expect(claims.filter(candidate => candidate.kind === 'in_progress')).toHaveLength(1)
  })

  it('derives stable, separate resource ids from the claimed operation', () => {
    const first = projectSetupOperationResourceIds('setup_0123456789abcdef0123456789abcdef01234567')
    const retry = projectSetupOperationResourceIds('setup_0123456789abcdef0123456789abcdef01234567')

    expect(first).toEqual(retry)
    expect(first.projectId).toMatch(/^setup_project_/)
    expect(first.organizationId).toMatch(/^setup_org_/)
    expect(first.projectId).not.toBe(first.organizationId)
  })

  it('renews a long-running lease before its original expiry', async () => {
    const { db } = fakeFirestore()
    let now = 1_000
    const repository = createProjectSetupOperationRepository(db, { nowMs: () => now, leaseMs: 100 })
    const input = { actorUserId: 'user-1', idempotencyKey: 'wizard-long-running', requestFingerprint }
    const first = await repository.claim(input)
    if (first.kind !== 'claimed') throw new Error('expected claim')

    now = 1_080
    await repository.heartbeat({ operationId: first.operationId, leaseToken: first.leaseToken })
    now = 1_150

    await expect(repository.claim(input)).resolves.toEqual({
      kind: 'in_progress', operationId: first.operationId,
    })
  })

  it('resumes durable progress after a partial result and replays the completed result', async () => {
    const { db } = fakeFirestore()
    let now = 1_000
    const repository = createProjectSetupOperationRepository(db, { nowMs: () => now })
    const input = { actorUserId: 'user-1', idempotencyKey: 'wizard-attempt-456', requestFingerprint }
    const first = await repository.claim(input)
    if (first.kind !== 'claimed') throw new Error('expected claim')
    await repository.checkpoint({
      operationId: first.operationId,
      leaseToken: first.leaseToken,
      checkpoint: { projectId: 'project-1' },
    })
    await repository.finish({
      operationId: first.operationId,
      leaseToken: first.leaseToken,
      checkpoint: { projectId: 'project-1' },
      result: result('partial'),
    })

    now += 1
    const retry = await repository.claim(input)
    expect(retry).toEqual(expect.objectContaining({
      kind: 'claimed', checkpoint: { projectId: 'project-1' },
    }))
    if (retry.kind !== 'claimed') throw new Error('expected retry claim')
    await repository.finish({
      operationId: retry.operationId,
      leaseToken: retry.leaseToken,
      checkpoint: { projectId: 'project-1' },
      result: result('ready'),
    })

    const replay = await repository.claim(input)
    expect(replay).toEqual(expect.objectContaining({ kind: 'replay', result: result('ready') }))
  })

  it('rejects a changed payload that reuses the same caller key', async () => {
    const { db } = fakeFirestore()
    const repository = createProjectSetupOperationRepository(db, { nowMs: () => 1_000 })
    const input = { actorUserId: 'user-1', idempotencyKey: 'wizard-attempt-789', requestFingerprint }
    await repository.claim(input)

    await expect(repository.claim({
      ...input,
      requestFingerprint: projectSetupRequestFingerprint({
        mode: 'standard', orgId: 'org-1', projectName: 'Different project', workspaceId: 'workspace-1',
        locationIds: ['vps-1'],
      }),
    })).rejects.toMatchObject<ProjectSetupIdempotencyError>({ status: 409 })
  })

  it('binds the same key independently to each authenticated caller', async () => {
    const { db } = fakeFirestore()
    const repository = createProjectSetupOperationRepository(db, { nowMs: () => 1_000 })
    const first = await repository.claim({
      actorUserId: 'user-1', idempotencyKey: 'shared-wizard-key', requestFingerprint,
    })
    const second = await repository.claim({
      actorUserId: 'user-2', idempotencyKey: 'shared-wizard-key', requestFingerprint,
    })

    expect(first.kind).toBe('claimed')
    expect(second.kind).toBe('claimed')
    if (first.kind === 'claimed' && second.kind === 'claimed') {
      expect(first.operationId).not.toBe(second.operationId)
    }
  })
})
