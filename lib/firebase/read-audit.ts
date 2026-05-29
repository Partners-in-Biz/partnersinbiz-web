import { AsyncLocalStorage } from 'async_hooks'

type FirestoreReadDescriptor = {
  target: string
}

type FirestoreReadEntry = {
  target: string
  operation: string
  operationCount: number
  readEstimate: number
}

type FirestoreReadAuditContext = {
  scope: string
  startedAt: number
  operationCount: number
  totalReadEstimate: number
  entries: Map<string, FirestoreReadEntry>
}

const auditStorage = new AsyncLocalStorage<FirestoreReadAuditContext>()
const wrappedTargets = new WeakMap<object, unknown>()

const CHAIN_METHODS = new Set([
  'collection',
  'collectionGroup',
  'doc',
  'where',
  'orderBy',
  'limit',
  'limitToLast',
  'offset',
  'select',
  'startAt',
  'startAfter',
  'endAt',
  'endBefore',
  'count',
  'sum',
  'avg',
])

function auditEnabled(): boolean {
  const value = (process.env.FIRESTORE_READ_AUDIT ?? '').trim().toLowerCase()
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true
  return process.env.NODE_ENV !== 'test'
}

function minimumReadsToLog(): number {
  const parsed = Number.parseInt(process.env.FIRESTORE_READ_AUDIT_MIN_READS ?? '25', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25
}

function appendTarget(base: string, part: unknown): string {
  const segment = String(part ?? '').trim()
  if (!segment) return base
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
  const cleanSegment = segment.startsWith('/') ? segment.slice(1) : segment
  return `${cleanBase}/${cleanSegment}`
}

function deriveDescriptor(
  descriptor: FirestoreReadDescriptor,
  methodName: string,
  args: unknown[],
): FirestoreReadDescriptor {
  if (methodName === 'collection') {
    return { target: appendTarget(descriptor.target, args[0]) }
  }
  if (methodName === 'collectionGroup') {
    return { target: appendTarget(descriptor.target, `**/${String(args[0] ?? '').trim()}`) }
  }
  if (methodName === 'doc') {
    return { target: appendTarget(descriptor.target, args[0]) }
  }
  return descriptor
}

function estimateReadCount(snapshot: unknown): number {
  if (Array.isArray(snapshot)) return Math.max(snapshot.length, 1)
  if (!snapshot || typeof snapshot !== 'object') return 1
  const value = snapshot as {
    docs?: unknown[]
    size?: number
    exists?: boolean
  }
  if (Array.isArray(value.docs)) return Math.max(value.docs.length, 1)
  if (typeof value.size === 'number' && Number.isFinite(value.size)) return Math.max(value.size, 1)
  if ('exists' in value) return 1
  return 1
}

function recordRead(descriptor: FirestoreReadDescriptor, operation: string, snapshot: unknown): void {
  if (!auditEnabled()) return
  const context = auditStorage.getStore()
  if (!context) return

  const readEstimate = estimateReadCount(snapshot)
  context.operationCount += 1
  context.totalReadEstimate += readEstimate

  const key = `${operation}:${descriptor.target}`
  const current = context.entries.get(key) ?? {
    target: descriptor.target,
    operation,
    operationCount: 0,
    readEstimate: 0,
  }
  current.operationCount += 1
  current.readEstimate += readEstimate
  context.entries.set(key, current)
}

function flushAudit(context: FirestoreReadAuditContext): void {
  if (!auditEnabled()) return
  if (context.totalReadEstimate < minimumReadsToLog()) return

  const topTargets = Array.from(context.entries.values())
    .sort((a, b) => b.readEstimate - a.readEstimate)
    .slice(0, 10)

  console.info('[firestore-read-audit]', {
    scope: context.scope,
    totalReadEstimate: context.totalReadEstimate,
    operationCount: context.operationCount,
    elapsedMs: Date.now() - context.startedAt,
    topTargets,
  })
}

export async function runWithFirestoreReadAudit<T>(
  scope: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (!auditEnabled()) return await fn()

  const existing = auditStorage.getStore()
  if (existing) return await fn()

  const context: FirestoreReadAuditContext = {
    scope,
    startedAt: Date.now(),
    operationCount: 0,
    totalReadEstimate: 0,
    entries: new Map(),
  }

  return await auditStorage.run(context, async () => {
    try {
      return await fn()
    } finally {
      flushAudit(context)
    }
  })
}

export function wrapFirestoreReadTarget<T extends object>(
  target: T,
  descriptor: FirestoreReadDescriptor = { target: 'firestore' },
): T {
  const existing = wrappedTargets.get(target)
  if (existing) return existing as T

  const proxy = new Proxy(target, {
    get(rawTarget, prop, receiver) {
      const value = Reflect.get(rawTarget, prop, receiver)
      if (typeof value !== 'function') return value

      return (...args: unknown[]) => {
        const methodName = String(prop)

        if (methodName === 'get') {
          const result = value.apply(rawTarget, args)
          if (result && typeof result.then === 'function') {
            return result.then((snapshot: unknown) => {
              recordRead(descriptor, 'get', snapshot)
              return snapshot
            })
          }
          recordRead(descriptor, 'get', result)
          return result
        }

        if (methodName === 'getAll') {
          const result = value.apply(rawTarget, args)
          if (result && typeof result.then === 'function') {
            return result.then((snapshots: unknown) => {
              recordRead(descriptor, 'getAll', snapshots)
              return snapshots
            })
          }
          recordRead(descriptor, 'getAll', result)
          return result
        }

        if (methodName === 'onSnapshot' && typeof args[0] === 'function') {
          const originalNext = args[0] as (...callbackArgs: unknown[]) => unknown
          const next = (snapshot: unknown, ...rest: unknown[]) => {
            recordRead(descriptor, 'onSnapshot', snapshot)
            return originalNext(snapshot, ...rest)
          }
          return value.apply(rawTarget, [next, ...args.slice(1)])
        }

        const result = value.apply(rawTarget, args)
        if (result && typeof result === 'object' && CHAIN_METHODS.has(methodName)) {
          return wrapFirestoreReadTarget(result, deriveDescriptor(descriptor, methodName, args))
        }
        return result
      }
    },
  })

  wrappedTargets.set(target, proxy)
  return proxy as T
}
