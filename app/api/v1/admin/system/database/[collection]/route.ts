// app/api/v1/admin/system/database/[collection]/route.ts
//
// US-275 — paginated document list for a single top-level collection.
// GET (admin) -> ?limit=25&startAfter=<docId>

import { NextRequest } from 'next/server'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

function serialiseValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialiseValue)
  if (value && typeof value === 'object') {
    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
      try { return (value as Timestamp).toDate().toISOString() } catch { /* fall through */ }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialiseValue(v)
    }
    return out
  }
  return value
}

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user, context?: { params: Promise<{ collection: string }> }) => {
    try {
      const { collection } = await context!.params

      // Validate against real collection names first.
      const colRefs = await adminDb.listCollections()
      const allowed = new Set(colRefs.map((c) => c.id))
      if (!allowed.has(collection)) return apiError('Unknown collection', 404)

      const url = new URL(req.url)
      const limitParam = parseInt(url.searchParams.get('limit') ?? '25', 10)
      const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 25, 1), 100)
      const startAfter = url.searchParams.get('startAfter')

      let query = adminDb
        .collection(collection)
        .orderBy(FieldPath.documentId())
        .limit(limit)

      if (startAfter) {
        query = query.startAfter(startAfter)
      }

      const snap = await query.get()
      const docs = snap.docs.map((d) => ({
        id: d.id,
        data: serialiseValue(d.data()),
      }))

      const nextCursor = docs.length === limit ? docs[docs.length - 1].id : null

      return apiSuccess({ docs, nextCursor })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
