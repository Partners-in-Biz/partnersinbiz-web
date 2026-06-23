// app/api/v1/admin/system/backups/route.ts
//
// US-308 — per-org backups.
//
// GET  (admin)        -> lists recent org_backups (cap 200) + the orgs list for
//                        the picker. Optional ?orgId= filter (in-memory).
// POST (super-admin)  -> REALLY exports an org's scoped collections to a single
//                        JSON blob, writes it to Firebase Storage (fallback to a
//                        Firestore backup_blobs doc), and records an org_backups
//                        job document.

import { NextRequest } from 'next/server'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import crypto from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Org-scoped collections backed up for a single organisation. Mirrors the
// org-wide GDPR export (app/api/v1/org/data-export/route.ts) plus `uploads`.
export const BACKUP_COLLECTIONS = [
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
  'uploads',
] as const

const COLLECTION_LIMIT = 5000

// Recursively convert Firestore Timestamps -> ISO strings for JSON output.
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
    console.error(`[admin/system/backups] gather ${collection} failed:`, err)
    return []
  }
}

async function resolveActorName(user: ApiUser): Promise<string> {
  try {
    const doc = await adminDb.collection('users').doc(user.uid).get()
    const d = doc.exists ? doc.data() : null
    if (d && typeof d.name === 'string' && d.name) return d.name
    if (d && typeof d.email === 'string' && d.email) return d.email
  } catch { /* ignore */ }
  return user.uid
}

function tsToIso(v: unknown): string | null {
  return v instanceof Timestamp ? v.toDate().toISOString() : null
}

function serialiseBackupDoc(id: string, d: Record<string, unknown>) {
  return {
    id,
    orgId: typeof d.orgId === 'string' ? d.orgId : '',
    status: typeof d.status === 'string' ? d.status : 'unknown',
    collections: Array.isArray(d.collections) ? d.collections : [],
    storagePath: typeof d.storagePath === 'string' ? d.storagePath : null,
    downloadUrl: typeof d.downloadUrl === 'string' ? d.downloadUrl : null,
    sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : null,
    docCount: typeof d.docCount === 'number' ? d.docCount : null,
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
    createdByName: typeof d.createdByName === 'string' ? d.createdByName : '',
    storageFallback: d.storageFallback === true,
    error: typeof d.error === 'string' ? d.error : null,
    createdAt: tsToIso(d.createdAt),
    finishedAt: tsToIso(d.finishedAt),
  }
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  try {
    const orgIdFilter = new URL(req.url).searchParams.get('orgId')

    const snap = await adminDb
      .collection('org_backups')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get()

    let backups = snap.docs.map((doc) => serialiseBackupDoc(doc.id, doc.data() as Record<string, unknown>))
    if (orgIdFilter) backups = backups.filter((b) => b.orgId === orgIdFilter)

    // Orgs list for the picker.
    const orgsSnap = await adminDb.collection('organizations').limit(500).get()
    const orgs = orgsSnap.docs
      .map((doc) => {
        const d = doc.data()
        return {
          id: doc.id,
          name: typeof d.name === 'string' ? d.name : doc.id,
          slug: typeof d.slug === 'string' ? d.slug : '',
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return apiSuccess({ backups, orgs })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

  let body: { orgId?: unknown; confirm?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : ''
  if (!orgId) return apiError('orgId is required', 400)
  if (confirm !== orgId) return apiError('confirm must equal the orgId', 400)

  // Verify the org exists.
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  const createdByName = await resolveActorName(user)
  const jobRef = adminDb.collection('org_backups').doc()

  try {
    await jobRef.set({
      orgId,
      status: 'running',
      collections: [...BACKUP_COLLECTIONS],
      createdBy: user.uid,
      createdByName,
      createdAt: FieldValue.serverTimestamp(),
    })

    // REAL export.
    const collections: Record<string, unknown[]> = {}
    const counts: Record<string, number> = {}
    for (const collection of BACKUP_COLLECTIONS) {
      const rows = await gatherCollection(collection, orgId)
      collections[collection] = rows
      counts[collection] = rows.length
    }

    const generatedAt = new Date().toISOString()
    const payload = {
      meta: { orgId, generatedAt, counts },
      collections,
    }

    const json = JSON.stringify(payload, null, 2)
    const buffer = Buffer.from(json, 'utf-8')
    const sizeBytes = buffer.byteLength
    const docCount = Object.values(counts).reduce((a, b) => a + b, 0)

    let storageFallback = false
    let storagePath: string | null = null
    let downloadUrl: string | null = null

    try {
      const bucket = getStorage(getAdminApp()).bucket()
      const filename = `backups/${orgId}/${Date.now()}-${jobRef.id}.json`
      const fileRef = bucket.file(filename)
      const downloadToken = crypto.randomUUID()
      await fileRef.save(buffer, {
        metadata: {
          contentType: 'application/json',
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      })
      storagePath = filename
      downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`
    } catch (storageErr) {
      // Storage write failed — fall back to a Firestore blob doc.
      console.error('[admin/system/backups] storage write failed, falling back:', storageErr)
      storageFallback = true
      await adminDb.collection('backup_blobs').doc(jobRef.id).set({
        orgId,
        json,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    await jobRef.update({
      status: 'completed',
      sizeBytes,
      docCount,
      storageFallback,
      storagePath: storagePath ?? FieldValue.delete(),
      downloadUrl: downloadUrl ?? FieldValue.delete(),
      finishedAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({ id: jobRef.id, status: 'completed', docCount, sizeBytes, storageFallback }, 201)
  } catch (err) {
    await jobRef
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => { /* job doc may not exist */ })
    return apiErrorFromException(err)
  }
})
