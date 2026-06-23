// app/api/v1/admin/system/backups/[id]/download/route.ts
//
// US-308 — download a backup's JSON.
// GET (super-admin):
//   - storagePath present -> try a signed URL (apiSuccess({ url })); if signing
//     fails, stream the file bytes as an application/json download.
//   - storageFallback     -> stream the backup_blobs JSON string as a download.
//   - 404 if neither.

import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const GET = withAuth('admin', async (_req: NextRequest, user, context?: { params: Promise<{ id: string }> }) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const { id } = await context!.params
    const doc = await adminDb.collection('org_backups').doc(id).get()
    if (!doc.exists) return apiError('Backup not found', 404)
    const d = doc.data() as Record<string, unknown>

    const storagePath = typeof d.storagePath === 'string' ? d.storagePath : null
    const storageFallback = d.storageFallback === true
    const filenameBase = `backup-${d.orgId ?? 'org'}-${id}.json`

    if (storagePath) {
      const bucket = getStorage(getAdminApp()).bucket()
      const fileRef = bucket.file(storagePath)
      // Prefer a short-lived signed URL.
      try {
        const [signedUrl] = await fileRef.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000,
        })
        return apiSuccess({ url: signedUrl })
      } catch (signErr) {
        console.error('[backups/download] signing failed, streaming bytes:', signErr)
        const [buffer] = await fileRef.download()
        return new Response(new Uint8Array(buffer), {
          headers: {
            'content-type': 'application/json',
            'content-disposition': `attachment; filename="${filenameBase}"`,
          },
        })
      }
    }

    if (storageFallback) {
      const blob = await adminDb.collection('backup_blobs').doc(id).get()
      if (!blob.exists) return apiError('Backup blob not found', 404)
      const json = blob.data()?.json
      if (typeof json !== 'string') return apiError('Backup blob is empty', 404)
      return new Response(json, {
        headers: {
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="${filenameBase}"`,
        },
      })
    }

    return apiError('No backup data available', 404)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
