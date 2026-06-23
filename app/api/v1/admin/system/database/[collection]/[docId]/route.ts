// app/api/v1/admin/system/database/[collection]/[docId]/route.ts
//
// US-275 — single-document fetch + delete.
// GET    (admin)        -> fetch one doc.
// DELETE (super admin)  -> delete one doc, gated by ?confirm=<collection>/<docId>.

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

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

type Ctx = { params: Promise<{ collection: string; docId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, context?: Ctx) => {
  try {
    const { collection, docId } = await context!.params

    const colRefs = await adminDb.listCollections()
    const allowed = new Set(colRefs.map((c) => c.id))
    if (!allowed.has(collection)) return apiError('Unknown collection', 404)

    const doc = await adminDb.collection(collection).doc(docId).get()
    if (!doc.exists) return apiError('Document not found', 404)

    return apiSuccess({ id: doc.id, data: serialiseValue(doc.data()) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, context?: Ctx) => {
  try {
    if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

    const { collection, docId } = await context!.params

    const url = new URL(req.url)
    const confirm = url.searchParams.get('confirm')
    if (confirm !== `${collection}/${docId}`) {
      return apiError('Confirmation token mismatch', 400)
    }

    const colRefs = await adminDb.listCollections()
    const allowed = new Set(colRefs.map((c) => c.id))
    if (!allowed.has(collection)) return apiError('Unknown collection', 404)

    await adminDb.collection(collection).doc(docId).delete()

    return apiSuccess({ deleted: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
