import { createHash, randomUUID } from 'node:crypto'
import type {
  ProjectSetupExecutionCheckpoint,
  ProjectSetupExecutionResult,
} from './project-setup-execution'

export const PROJECT_SETUP_OPERATIONS_COLLECTION = 'project_setup_operations'

const DEFAULT_LEASE_MS = 10 * 60 * 1000

export interface ProjectSetupOperationDocumentReference {
  id: string
  collectionName: string
  [key: string]: unknown
}

export interface ProjectSetupOperationDocumentSnapshot {
  id: string
  exists: boolean
  data(): Record<string, unknown> | undefined
}

export interface ProjectSetupOperationTransaction {
  get(reference: ProjectSetupOperationDocumentReference): Promise<ProjectSetupOperationDocumentSnapshot>
  create(reference: ProjectSetupOperationDocumentReference, data: Record<string, unknown>): void
  set(
    reference: ProjectSetupOperationDocumentReference,
    data: Record<string, unknown>,
    options?: { merge: boolean },
  ): void
}

export interface ProjectSetupOperationFirestore {
  collection(name: string): { doc(id: string): ProjectSetupOperationDocumentReference }
  runTransaction<T>(callback: (transaction: ProjectSetupOperationTransaction) => Promise<T>): Promise<T>
}

export class ProjectSetupIdempotencyError extends Error {
  constructor(message: string, readonly status: 409) {
    super(message)
    this.name = 'ProjectSetupIdempotencyError'
  }
}

type ProjectSetupOperationClaim =
  | {
      kind: 'claimed'
      operationId: string
      leaseToken: string
      checkpoint: ProjectSetupExecutionCheckpoint
    }
  | { kind: 'in_progress'; operationId: string }
  | { kind: 'replay'; operationId: string; result: ProjectSetupExecutionResult }

interface ClaimInput {
  actorUserId: string
  idempotencyKey: string
  requestFingerprint: string
}

interface LeaseInput {
  operationId: string
  leaseToken: string
  checkpoint: ProjectSetupExecutionCheckpoint
}

interface HeartbeatInput {
  operationId: string
  leaseToken: string
}

interface FinishInput extends LeaseInput {
  result: ProjectSetupExecutionResult
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Project setup payload contains an invalid number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`
  }
  throw new Error('Project setup payload is not JSON serializable')
}

export function projectSetupRequestFingerprint(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function cleanIdempotencyKey(value: string): string {
  const key = value.trim()
  if (key.length < 8 || key.length > 256 || /[\u0000-\u001f]/.test(key)) {
    throw new ProjectSetupIdempotencyError('Project setup idempotency key is invalid', 409)
  }
  return key
}

export function projectSetupOperationId(actorUserId: string, idempotencyKey: string): string {
  const actor = actorUserId.trim()
  if (!actor) throw new ProjectSetupIdempotencyError('Project setup caller identity is invalid', 409)
  const key = cleanIdempotencyKey(idempotencyKey)
  return `setup_${createHash('sha256').update(`${actor}\0${key}`).digest('hex').slice(0, 40)}`
}

export function projectSetupOperationResourceIds(operationId: string): {
  projectId: string
  organizationId: string
} {
  const operation = operationId.trim()
  if (!operation) throw new ProjectSetupIdempotencyError('Project setup operation identity is invalid', 409)
  const digest = createHash('sha256').update(operation).digest('hex').slice(0, 40)
  return {
    projectId: `setup_project_${digest}`,
    organizationId: `setup_org_${digest}`,
  }
}

function checkpointFrom(value: unknown): ProjectSetupExecutionCheckpoint {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ProjectSetupExecutionCheckpoint
    : {}
}

function resultFrom(value: unknown): ProjectSetupExecutionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Partial<ProjectSetupExecutionResult>
  return result.plan && Array.isArray(result.replicas) && typeof result.status === 'number'
    ? result as ProjectSetupExecutionResult
    : null
}

export interface ProjectSetupOperationRepository {
  claim(input: ClaimInput): Promise<ProjectSetupOperationClaim>
  heartbeat(input: HeartbeatInput): Promise<void>
  checkpoint(input: LeaseInput): Promise<void>
  finish(input: FinishInput): Promise<void>
  fail(input: LeaseInput): Promise<void>
}

export function createProjectSetupOperationRepository(
  db: ProjectSetupOperationFirestore,
  options: { nowMs?: () => number; leaseMs?: number } = {},
): ProjectSetupOperationRepository {
  const nowMs = options.nowMs ?? Date.now
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const operationRef = (operationId: string) => db.collection(PROJECT_SETUP_OPERATIONS_COLLECTION).doc(operationId)

  function requireLease(row: Record<string, unknown>, input: { operationId: string; leaseToken: string }) {
    if (row.status !== 'running' || row.leaseToken !== input.leaseToken) {
      throw new ProjectSetupIdempotencyError('Project setup operation lease is no longer active', 409)
    }
  }

  return {
    async claim(input) {
      const operationId = projectSetupOperationId(input.actorUserId, input.idempotencyKey)
      const keyHash = createHash('sha256').update(cleanIdempotencyKey(input.idempotencyKey)).digest('hex')
      return db.runTransaction(async (transaction) => {
        const ref = operationRef(operationId)
        const snapshot = await transaction.get(ref)
        const now = nowMs()
        if (!snapshot.exists) {
          const leaseToken = randomUUID()
          transaction.create(ref, {
            operationId,
            actorUserId: input.actorUserId,
            keyHash,
            requestFingerprint: input.requestFingerprint,
            status: 'running',
            attempt: 1,
            checkpoint: {},
            leaseToken,
            leaseExpiresAtMs: now + leaseMs,
            createdAtMs: now,
            updatedAtMs: now,
          })
          return { kind: 'claimed', operationId, leaseToken, checkpoint: {} }
        }

        const row = snapshot.data() ?? {}
        if (row.operationId !== operationId || row.actorUserId !== input.actorUserId
          || row.keyHash !== keyHash || row.requestFingerprint !== input.requestFingerprint) {
          throw new ProjectSetupIdempotencyError(
            'This project setup key was already used with a different request',
            409,
          )
        }
        if (row.status === 'complete') {
          const result = resultFrom(row.result)
          if (!result) {
            throw new ProjectSetupIdempotencyError('Project setup replay is unavailable', 409)
          }
          return { kind: 'replay', operationId, result }
        }
        if (row.status === 'running' && typeof row.leaseExpiresAtMs === 'number' && row.leaseExpiresAtMs > now) {
          return { kind: 'in_progress', operationId }
        }

        const leaseToken = randomUUID()
        const checkpoint = checkpointFrom(row.checkpoint)
        transaction.set(ref, {
          status: 'running',
          attempt: typeof row.attempt === 'number' ? row.attempt + 1 : 2,
          leaseToken,
          leaseExpiresAtMs: now + leaseMs,
          updatedAtMs: now,
        }, { merge: true })
        return { kind: 'claimed', operationId, leaseToken, checkpoint }
      })
    },

    async heartbeat(input) {
      await db.runTransaction(async (transaction) => {
        const ref = operationRef(input.operationId)
        const snapshot = await transaction.get(ref)
        const row = snapshot.data() ?? {}
        requireLease(row, input)
        const now = nowMs()
        transaction.set(ref, {
          leaseExpiresAtMs: now + leaseMs,
          updatedAtMs: now,
        }, { merge: true })
      })
    },

    async checkpoint(input) {
      await db.runTransaction(async (transaction) => {
        const ref = operationRef(input.operationId)
        const snapshot = await transaction.get(ref)
        const row = snapshot.data() ?? {}
        requireLease(row, input)
        const now = nowMs()
        transaction.set(ref, {
          checkpoint: input.checkpoint,
          leaseExpiresAtMs: now + leaseMs,
          updatedAtMs: now,
        }, { merge: true })
      })
    },

    async finish(input) {
      await db.runTransaction(async (transaction) => {
        const ref = operationRef(input.operationId)
        const snapshot = await transaction.get(ref)
        const row = snapshot.data() ?? {}
        requireLease(row, input)
        const complete = input.result.plan.state !== 'partial'
        transaction.set(ref, {
          status: complete ? 'complete' : 'retryable',
          checkpoint: input.checkpoint,
          result: input.result,
          leaseToken: null,
          leaseExpiresAtMs: 0,
          updatedAtMs: nowMs(),
        }, { merge: true })
      })
    },

    async fail(input) {
      await db.runTransaction(async (transaction) => {
        const ref = operationRef(input.operationId)
        const snapshot = await transaction.get(ref)
        const row = snapshot.data() ?? {}
        requireLease(row, input)
        transaction.set(ref, {
          status: 'retryable',
          checkpoint: input.checkpoint,
          leaseToken: null,
          leaseExpiresAtMs: 0,
          updatedAtMs: nowMs(),
        }, { merge: true })
      })
    },
  }
}
