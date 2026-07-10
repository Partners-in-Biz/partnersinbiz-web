import { adminDb } from '@/lib/firebase/admin'

type FirestoreRow = Record<string, unknown> & { id: string }

function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function isMissingIndexError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const source = error as { code?: unknown; message?: unknown }
  return source.code === 9
    || source.code === 'failed-precondition'
    || source.code === 'firestore/failed-precondition'
    || (typeof source.message === 'string' && source.message.toLowerCase().includes('requires an index'))
}

/**
 * Keep the indexed query as the normal fast path. While a newly declared
 * composite index is absent or building, fall back to the already tenant-safe
 * documentId equality query and restore the requested ordering in memory.
 */
export async function getRecentDocumentRows({
  collectionName,
  documentId,
  orderField,
  limit,
}: {
  collectionName: string
  documentId: string
  orderField: string
  limit: number
}): Promise<FirestoreRow[]> {
  const scopedQuery = adminDb.collection(collectionName).where('documentId', '==', documentId)

  try {
    const snap = await scopedQuery.orderBy(orderField, 'desc').limit(limit).get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as FirestoreRow)
  } catch (error) {
    if (!isMissingIndexError(error)) throw error
  }

  const fallbackSnap = await scopedQuery.get()
  return fallbackSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as FirestoreRow)
    .sort((left, right) => timestampMillis(right[orderField]) - timestampMillis(left[orderField]))
    .slice(0, limit)
}
