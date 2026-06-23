// app/api/v1/org/data-export/route.ts
//
// GDPR org-wide data export (US-196).
//
// The existing route at app/api/v1/portal/data-export/route.ts streams the
// org's *metrics* rows + Life OS personal data inline. This route is the
// ORG-WIDE export: it assembles the organisation profile plus the readily
// org-scoped CRM/business records (contacts, companies, deals, leads, etc.),
// writes the assembled JSON to Firebase Storage, and records a job doc in the
// 'data_exports' collection.
//
// POST (admin) -> creates job (status:processing) -> gathers -> uploads JSON
//                 -> marks status:complete with downloadUrl.
// GET  (admin) -> lists previous export jobs for the org, most recent first.

import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import crypto from 'crypto'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Per-collection row cap keeps the synchronous gather bounded.
const COLLECTION_LIMIT = 5000

// Org-scoped collections to include in the export. Each is queried by orgId.
const ORG_COLLECTIONS = [
  'contacts',
  'companies',
  'deals',
  'leads',
  'quotes',
  'proposals',
  'orders',
  'projects',
  'tasks',
  'invoices',
  'activity',
  'orgMembers',
  'form_submissions',
] as const

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

async function gatherCollection(collection: string, orgId: string): Promise<Record<string, unknown>[]> {
  try {
    const snap = await adminDb
      .collection(collection)
      .where('orgId', '==', orgId)
      .limit(COLLECTION_LIMIT)
      .get()
    return snap.docs.map((doc) => ({ id: doc.id, ...(serialiseValue(doc.data()) as Record<string, unknown>) }))
  } catch (err) {
    // A missing index or collection should not abort the whole export.
    console.error(`[org/data-export] gather ${collection} failed:`, err)
    return []
  }
}

export const POST = withPortalAuthAndRole('admin', async (_req: NextRequest, uid: string, orgId: string, role: string) => {
  // Create the job doc up front so it shows as "processing" if anything later fails.
  const jobRef = adminDb.collection('data_exports').doc()
  try {
    await jobRef.set({
      orgId,
      status: 'processing',
      scope: 'organization',
      requestedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    })

    // Organisation profile.
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) {
      await jobRef.update({ status: 'failed', error: 'Organisation not found', completedAt: FieldValue.serverTimestamp() })
      return apiError('Organisation not found', 404)
    }

    const collections: Record<string, unknown[]> = {}
    const counts: Record<string, number> = {}
    for (const collection of ORG_COLLECTIONS) {
      const rows = await gatherCollection(collection, orgId)
      collections[collection] = rows
      counts[collection] = rows.length
    }

    const generatedAt = new Date().toISOString()
    const exportPayload = {
      meta: {
        scope: 'organization',
        orgId,
        generatedAt,
        requestedBy: uid,
        counts,
        format: 'gdpr-json-v1',
      },
      organization: { id: orgId, ...(serialiseValue(orgDoc.data()) as Record<string, unknown>) },
      collections,
    }

    // Store assembled JSON in Firebase Storage with a download token.
    const bucket = getStorage(getAdminApp()).bucket()
    const filename = `data-exports/${orgId}/${Date.now()}-${jobRef.id}.json`
    const fileRef = bucket.file(filename)
    const downloadToken = crypto.randomUUID()
    const buffer = Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf-8')

    await fileRef.save(buffer, {
      metadata: {
        contentType: 'application/json',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    })

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`
    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)

    await jobRef.update({
      status: 'complete',
      downloadUrl,
      storagePath: filename,
      sizeBytes: buffer.byteLength,
      counts,
      totalRecords,
      completedAt: FieldValue.serverTimestamp(),
    })

    await logActivity({
      orgId,
      type: 'org_data_exported',
      actorId: uid,
      actorName: uid,
      actorRole: role === 'admin' || role === 'owner' ? 'admin' : 'client',
      description: `Generated org-wide GDPR data export (${totalRecords} records across ${Object.keys(counts).length} collections)`,
      entityType: 'data_export',
      entityId: jobRef.id,
    })

    return apiSuccess(
      {
        id: jobRef.id,
        status: 'complete',
        downloadUrl,
        sizeBytes: buffer.byteLength,
        counts,
        totalRecords,
        generatedAt,
      },
      201,
    )
  } catch (err) {
    await jobRef
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => { /* job doc may not exist if set() failed */ })
    return apiErrorFromException(err)
  }
})

export const GET = withPortalAuthAndRole('admin', async (req: NextRequest, _uid: string, orgId: string) => {
  try {
    const limitParam = parseInt(new URL(req.url).searchParams.get('limit') ?? '', 10)
    const limit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : 25), 100)

    const snap = await adminDb
      .collection('data_exports')
      .where('orgId', '==', orgId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()

    const exports = snap.docs.map((doc) => {
      const d = doc.data()
      const createdAt = d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null
      const completedAt = d.completedAt instanceof Timestamp ? d.completedAt.toDate().toISOString() : null
      return {
        id: doc.id,
        status: typeof d.status === 'string' ? d.status : 'unknown',
        scope: typeof d.scope === 'string' ? d.scope : 'organization',
        requestedBy: typeof d.requestedBy === 'string' ? d.requestedBy : '',
        downloadUrl: typeof d.downloadUrl === 'string' ? d.downloadUrl : null,
        sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : null,
        totalRecords: typeof d.totalRecords === 'number' ? d.totalRecords : null,
        error: typeof d.error === 'string' ? d.error : null,
        createdAt,
        completedAt,
      }
    })

    return apiSuccess({ exports, count: exports.length })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
