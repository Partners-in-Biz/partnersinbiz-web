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
import { writeAdminAudit } from '@/lib/admin/audit'
import { BACKUP_COLLECTIONS } from '@/app/api/v1/admin/system/backups/route'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH_SIZE = 400

interface BackupPayload {
  meta?: { orgId?: string }
  collections?: Record<string, Array<Record<string, unknown>>>
}

const ALLOWED_COLLECTIONS = new Set<string>(BACKUP_COLLECTIONS)

async function auditRestoreAttempt(
  user: ApiUser,
  opts: {
    backupId: string
    orgId: string | null
    outcome: 'completed' | 'rejected'
    reason?: string
    metadata?: Record<string, unknown>
  },
) {
  await writeAdminAudit(user, {
    action: 'system.backup.restore',
    orgId: opts.orgId,
    summary: `${opts.outcome === 'completed' ? 'Restored' : 'Rejected'} backup restore ${opts.backupId}`,
    metadata: {
      backupId: opts.backupId,
      outcome: opts.outcome,
      reason: opts.reason ?? null,
      ...(opts.metadata ?? {}),
    },
  })
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
    const doc = await adminDb.collection('org_backups').doc(id).get()
    if (!doc.exists) {
      await auditRestoreAttempt(user, {
        backupId: id,
        orgId: null,
        outcome: 'rejected',
        reason: 'backup_not_found',
      })
      return apiError('Backup not found', 404)
    }

    const backupData = doc.data() as Record<string, unknown>
    const backupOrgId = typeof backupData.orgId === 'string' ? backupData.orgId : null
    const expectedConfirm = backupOrgId ? `RESTORE ${id} ${backupOrgId}` : `RESTORE ${id}`

    let body: { confirm?: unknown }
    try {
      body = await req.json()
    } catch {
      return apiError('Invalid JSON body', 400)
    }
    const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : ''
    if (confirm !== expectedConfirm) {
      await auditRestoreAttempt(user, {
        backupId: id,
        orgId: backupOrgId,
        outcome: 'rejected',
        reason: 'confirmation_mismatch',
        metadata: { expectedConfirm },
      })
      return apiError(`confirm must equal "${expectedConfirm}"`, 400)
    }

    const payload = await loadBackupJson(id, backupData)
    if (!payload || !payload.collections) {
      await auditRestoreAttempt(user, {
        backupId: id,
        orgId: backupOrgId,
        outcome: 'rejected',
        reason: 'backup_unavailable',
      })
      return apiError('Backup data unavailable', 404)
    }
    if (!backupOrgId || payload.meta?.orgId !== backupOrgId) {
      await auditRestoreAttempt(user, {
        backupId: id,
        orgId: backupOrgId,
        outcome: 'rejected',
        reason: 'org_mismatch',
        metadata: { payloadOrgId: payload.meta?.orgId ?? null },
      })
      return apiError('Backup payload.meta.orgId must match the backup orgId', 400)
    }

    const disallowedCollections = Object.keys(payload.collections).filter((collection) => !ALLOWED_COLLECTIONS.has(collection))
    if (disallowedCollections.length > 0) {
      await auditRestoreAttempt(user, {
        backupId: id,
        orgId: backupOrgId,
        outcome: 'rejected',
        reason: 'disallowed_collections',
        metadata: { disallowedCollections },
      })
      return apiError(`Backup contains disallowed collections: ${disallowedCollections.join(', ')}`, 400)
    }

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

    await auditRestoreAttempt(user, {
      backupId: id,
      orgId: backupOrgId,
      outcome: 'completed',
      metadata: {
        restoredCollections,
        restoredCount,
      },
    })

    return apiSuccess({ restored: true, restoredCount, collections: restoredCollections })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
