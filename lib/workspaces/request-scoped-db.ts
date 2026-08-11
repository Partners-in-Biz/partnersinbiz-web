/**
 * Request-scoped memo over Firestore full-collection and simple where gets.
 *
 * GET /api/v1/workspaces used to call discoverAuthorizedRuntimeTargets once per
 * workspace. Each call scanned linked_devices / grants / mappings / credentials
 * end-to-end. Memoizing identical collection/query gets inside one request turns
 * that into a single scan while preserving per-workspace authorization logic.
 */

export interface RequestScopedSnapshot {
  exists: boolean
  id?: string
  data(): Record<string, unknown> | undefined
}

export interface RequestScopedQuerySnapshot {
  docs: Array<{ id?: string; data(): Record<string, unknown> }>
}

/** Structural db shape accepted by runtime-target + execution-location discovery. */
export interface RequestScopedDbLike {
  collection(name: string): {
    doc(id: string): { get(): Promise<RequestScopedSnapshot> }
    where?(field: string, op: string, value: unknown): { get(): Promise<RequestScopedQuerySnapshot> }
    get(): Promise<RequestScopedQuerySnapshot>
  }
}

type UnderlyingSnapshot = {
  exists: boolean
  id?: string
  data(): Record<string, unknown> | undefined
}

type UnderlyingQuerySnapshot = {
  docs: Array<{ id?: string; data(): Record<string, unknown> | undefined }>
}

type UnderlyingDb = {
  collection(name: string): {
    doc(id: string): { get(): Promise<UnderlyingSnapshot> }
    where(field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown): {
      get(): Promise<UnderlyingQuerySnapshot>
    }
    get(): Promise<UnderlyingQuerySnapshot>
  }
}

function normalizeSnapshot(snap: UnderlyingSnapshot): RequestScopedSnapshot {
  return {
    exists: snap.exists === true,
    id: snap.id,
    data: () => snap.data(),
  }
}

function normalizeQuery(snap: UnderlyingQuerySnapshot): RequestScopedQuerySnapshot {
  return {
    docs: (snap.docs || []).map((doc) => ({
      id: doc.id,
      data: () => doc.data() || {},
    })),
  }
}

export function createRequestScopedDb(db: UnderlyingDb): RequestScopedDbLike {
  const docGets = new Map<string, Promise<RequestScopedSnapshot>>()
  const collectionGets = new Map<string, Promise<RequestScopedQuerySnapshot>>()
  const queryGets = new Map<string, Promise<RequestScopedQuerySnapshot>>()

  return {
    collection(name: string) {
      const collection = db.collection(name)
      return {
        doc(id: string) {
          return {
            get: () => {
              const key = `${name}\0${id}`
              let pending = docGets.get(key)
              if (!pending) {
                pending = collection.doc(id).get().then(normalizeSnapshot)
                docGets.set(key, pending)
              }
              return pending
            },
          }
        },
        where(field: string, op: string, value: unknown) {
          return {
            get: () => {
              const key = `${name}\0${field}\0${op}\0${JSON.stringify(value)}`
              let pending = queryGets.get(key)
              if (!pending) {
                pending = collection
                  .where(field, op as FirebaseFirestore.WhereFilterOp, value)
                  .get()
                  .then(normalizeQuery)
                queryGets.set(key, pending)
              }
              return pending
            },
          }
        },
        get: () => {
          let pending = collectionGets.get(name)
          if (!pending) {
            pending = collection.get().then(normalizeQuery)
            collectionGets.set(name, pending)
          }
          return pending
        },
      }
    },
  }
}
