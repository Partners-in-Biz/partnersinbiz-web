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
import { writeAdminAudit } from '@/lib/admin/audit'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const RESTRICTED_DELETE_COLLECTIONS = new Set([
  'admin_audit_log',
  'backup_blobs',
  'org_backups',
  'organizations',
  'plans',
  'rate_limit_config',
  'rate_limit_overrides',
  'users',
])

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

async function auditDatabaseDelete(
  user: ApiUser,
  opts: {
    collection: string
    docId: string
    outcome: 'completed' | 'rejected'
    reason?: string
    orgId?: string | null
  },
) {
  await writeAdminAudit(user, {
    action: 'system.database.delete',
    orgId: opts.orgId ?? null,
    summary: `${opts.outcome === 'completed' ? 'Deleted' : 'Rejected delete for'} ${opts.collection}/${opts.docId}`,
    metadata: {
      collection: opts.collection,
      docId: opts.docId,
      outcome: opts.outcome,
      reason: opts.reason ?? null,
    },
  })
}

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
    const expectedConfirm = `DELETE ${collection}/${docId}`

    const url = new URL(req.url)
    const confirm = url.searchParams.get('confirm')
    if (confirm !== expectedConfirm) {
      await auditDatabaseDelete(user, {
        collection,
        docId,
        outcome: 'rejected',
        reason: 'confirmation_mismatch',
      })
      return apiError('Confirmation token mismatch', 400)
    }

    const colRefs = await adminDb.listCollections()
    const allowed = new Set(colRefs.map((c) => c.id))
    if (!allowed.has(collection)) return apiError('Unknown collection', 404)
    if (RESTRICTED_DELETE_COLLECTIONS.has(collection)) {
      await auditDatabaseDelete(user, {
        collection,
        docId,
        outcome: 'rejected',
        reason: 'restricted_collection',
      })
      return apiError('Deletes are restricted for this collection', 403)
    }

    const docRef = adminDb.collection(collection).doc(docId)
    const docSnap = await docRef.get()
    if (!docSnap.exists) return apiError('Document not found', 404)

    const docData = docSnap.data() as Record<string, unknown> | undefined
    const orgId = typeof docData?.orgId === 'string' ? docData.orgId : null

    await docRef.delete()
    await auditDatabaseDelete(user, {
      collection,
      docId,
      orgId,
      outcome: 'completed',
    })

    return apiSuccess({ deleted: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
