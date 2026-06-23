// app/api/v1/admin/system/backups/[id]/restore/route.ts
//
// US-308 — restore a backup into live Firestore (UPSERT only, never deletes).
// POST (super-admin + typed-confirm): body { confirm } must equal the backup id.
// Loads the backup JSON (Storage download() or backup_blobs), then upserts each
// doc back into its collection by id in 400-doc batches (merge:true).

import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH_SIZE = 400

interface BackupPayload {
  meta?: { orgId?: string }
  collections?: Record<string, Array<Record<string, unknown>>>
}

async function loadBackupJson(id: string, d: Record<string, unknown>): Promise<BackupPayload | null> {
  const storagePath = typeof d.storagePath === 'string' ? d.storagePath : null
  const storageFallback = d.storageFallback === true

  if (storagePath) {
    const bucket = getStorage(getAdminApp()).bucket()
    const [buffer] = await bucket.file(storagePath).download()
    return JSON.parse(buffer.toString('utf-8')) as BackupPayload
  }
  if (storageFallback) {
    const blob = await adminDb.collection('backup_blobs').doc(id).get()
    const json = blob.exists ? blob.data()?.json : null
    if (typeof json !== 'string') return null
    return JSON.parse(json) as BackupPayload
  }
  return null
}

export const POST = withAuth('admin', async (req: NextRequest, user, context?: { params: Promise<{ id: string }> }) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const { id } = await context!.params

    let body: { confirm?: unknown }
    try {
      body = await req.json()
    } catch {
      return apiError('Invalid JSON body', 400)
    }
    const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : ''
    if (confirm !== id) return apiError('confirm must equal the backup id', 400)

    const doc = await adminDb.collection('org_backups').doc(id).get()
    if (!doc.exists) return apiError('Backup not found', 404)

    const payload = await loadBackupJson(id, doc.data() as Record<string, unknown>)
    if (!payload || !payload.collections) return apiError('Backup data unavailable', 404)

    const restoredCollections: string[] = []
    let restoredCount = 0

    for (const [collection, docs] of Object.entries(payload.collections)) {
      if (!Array.isArray(docs) || docs.length === 0) continue
      restoredCollections.push(collection)

      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const chunk = docs.slice(i, i + BATCH_SIZE)
        const batch = adminDb.batch()
        for (const row of chunk) {
          const docId = typeof row.id === 'string' ? row.id : null
          if (!docId) continue
          const { id: _omit, ...data } = row
          batch.set(adminDb.collection(collection).doc(docId), data, { merge: true })
          restoredCount++
        }
        await batch.commit()
      }
    }

    return apiSuccess({ restored: true, restoredCount, collections: restoredCollections })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
