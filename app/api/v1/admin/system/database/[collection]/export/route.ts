// app/api/v1/admin/system/database/[collection]/export/route.ts
//
// US-275 — JSON export of up to 5000 docs in a collection (super admin only).
// GET (super admin) -> { collection, count, capped, cap, docs }

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX = 5000

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

type Ctx = { params: Promise<{ collection: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user, context?: Ctx) => {
  try {
    if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

    const { collection } = await context!.params

    const colRefs = await adminDb.listCollections()
    const allowed = new Set(colRefs.map((c) => c.id))
    if (!allowed.has(collection)) return apiError('Unknown collection', 404)

    const snap = await adminDb.collection(collection).limit(MAX).get()
    const docs = snap.docs.map((d) => ({ id: d.id, data: serialiseValue(d.data()) }))
    const count = docs.length

    return apiSuccess({
      collection,
      count,
      capped: count >= MAX,
      cap: MAX,
      docs,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
