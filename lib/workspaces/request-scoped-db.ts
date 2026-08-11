/**
 * Request-scoped memo over Firestore full-collection and simple where gets.
 *
 * GET /api/v1/workspaces used to call discoverAuthorizedRuntimeTargets once per
 * workspace. Each call scanned linked_devices / grants / mappings / credentials
 * end-to-end. Memoizing identical collection/query gets inside one request turns
 * that into a single scan while preserving per-workspace authorization logic.
 */

interface SnapshotLike {
  exists?: boolean
  id?: string
  data(): Record<string, unknown> | undefined
}

interface QuerySnapshotLike {
  docs: SnapshotLike[]
}

export interface RequestScopedDbLike {
  collection(name: string): {
    doc(id: string): { get(): Promise<SnapshotLike> }
    where?(field: string, op: string, value: unknown): { get(): Promise<QuerySnapshotLike> }
    get(): Promise<QuerySnapshotLike>
  }
}

type UnderlyingDb = {
  collection(name: string): {
    doc(id: string): { get(): Promise<SnapshotLike> }
    where(field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown): {
      get(): Promise<QuerySnapshotLike>
    }
    get(): Promise<QuerySnapshotLike>
  }
}

export function createRequestScopedDb(db: UnderlyingDb): RequestScopedDbLike {
  const docGets = new Map<string, Promise<SnapshotLike>>()
  const collectionGets = new Map<string, Promise<QuerySnapshotLike>>()
  const queryGets = new Map<string, Promise<QuerySnapshotLike>>()

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
                pending = collection.doc(id).get()
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
                pending = collection.where(field, op as FirebaseFirestore.WhereFilterOp, value).get()
                queryGets.set(key, pending)
              }
              return pending
            },
          }
        },
        get: () => {
          let pending = collectionGets.get(name)
          if (!pending) {
            pending = collection.get()
            collectionGets.set(name, pending)
          }
          return pending
        },
      }
    },
  }
}
