// app/api/v1/admin/system/backups/[id]/diff/route.ts
//
// US-308 — diff a backup against current live Firestore.
// GET (admin, read-only): for each collection in the backup, re-query live docs
// (where orgId == ...) and compute per-collection added / removed / changed /
// unchanged counts by id-set membership + JSON-string comparison.

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const COLLECTION_LIMIT = 5000

interface BackupPayload {
  meta?: { orgId?: string }
  collections?: Record<string, Array<Record<string, unknown>>>
}

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

// Stable JSON-string of a doc's data (id excluded) for change comparison.
function stableJson(data: Record<string, unknown>): string {
  const { id: _omit, ...rest } = data
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(rest).sort()) sorted[k] = rest[k]
  return JSON.stringify(sorted)
}

export const GET = withAuth('admin', async (_req: NextRequest, _user, context?: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await context!.params
    const doc = await adminDb.collection('org_backups').doc(id).get()
    if (!doc.exists) return apiError('Backup not found', 404)
    const d = doc.data() as Record<string, unknown>
    const orgId = typeof d.orgId === 'string' ? d.orgId : ''

    const payload = await loadBackupJson(id, d)
    if (!payload || !payload.collections) return apiError('Backup data unavailable', 404)

    const perCollection: Record<string, { added: number; removed: number; changed: number; unchanged: number }> = {}
    const totals = { added: 0, removed: 0, changed: 0, unchanged: 0 }

    for (const [collection, backupDocs] of Object.entries(payload.collections)) {
      const backupMap = new Map<string, string>()
      for (const row of Array.isArray(backupDocs) ? backupDocs : []) {
        const docId = typeof row.id === 'string' ? row.id : null
        if (docId) backupMap.set(docId, stableJson(row))
      }

      // Live docs.
      const liveMap = new Map<string, string>()
      try {
        const snap = await adminDb
          .collection(collection)
          .where('orgId', '==', orgId)
          .limit(COLLECTION_LIMIT)
          .get()
        for (const docSnap of snap.docs) {
          liveMap.set(docSnap.id, stableJson({ id: docSnap.id, ...(serialiseValue(docSnap.data()) as Record<string, unknown>) }))
        }
      } catch (err) {
        console.error(`[backups/diff] live query ${collection} failed:`, err)
      }

      let added = 0
      let removed = 0
      let changed = 0
      let unchanged = 0

      for (const [docId, liveJson] of liveMap) {
        if (!backupMap.has(docId)) added++
        else if (backupMap.get(docId) !== liveJson) changed++
        else unchanged++
      }
      for (const docId of backupMap.keys()) {
        if (!liveMap.has(docId)) removed++
      }

      perCollection[collection] = { added, removed, changed, unchanged }
      totals.added += added
      totals.removed += removed
      totals.changed += changed
      totals.unchanged += unchanged
    }

    return apiSuccess({ orgId, perCollection, totals })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
