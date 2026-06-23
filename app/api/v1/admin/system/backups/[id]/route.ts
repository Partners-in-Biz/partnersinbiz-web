// app/api/v1/admin/system/backups/[id]/route.ts
//
// US-308 — single backup metadata.
// GET (admin) -> serialised org_backups doc, 404 if missing.

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

function tsToIso(v: unknown): string | null {
  return v instanceof Timestamp ? v.toDate().toISOString() : null
}

export const GET = withAuth('admin', async (_req: NextRequest, _user, context?: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await context!.params
    const doc = await adminDb.collection('org_backups').doc(id).get()
    if (!doc.exists) return apiError('Backup not found', 404)
    const d = doc.data() as Record<string, unknown>
    return apiSuccess({
      id: doc.id,
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
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
