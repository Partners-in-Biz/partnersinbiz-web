/**
 * GET    /api/v1/admin/system/storage/orphans   (admin)
 * DELETE /api/v1/admin/system/storage/orphans    (super-admin)
 *
 * Orphan detection between Firebase Storage objects and `uploads` doc
 * `storagePath` values.
 *
 *  - orphans      = Storage objects whose name is NOT referenced by any
 *                   uploads doc storagePath.
 *  - missingBlobs = uploads docs whose storagePath was not found among the
 *                   listed Storage objects. Only meaningful when the Storage
 *                   scan was NOT truncated — flagged via `truncated`.
 *
 * Storage enumeration may be denied if credentials lack Storage admin access;
 * in that case we report `storageAvailable: false` rather than fabricating.
 */
import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const SCAN_CAP = 2000
const UPLOADS_CAP = 20000

async function loadUploadPaths(): Promise<{ paths: Set<string>; docs: Array<{ id: string; storagePath: string; orgId: string | null }> }> {
  const snap = await adminDb.collection('uploads').limit(UPLOADS_CAP).get()
  const paths = new Set<string>()
  const docs: Array<{ id: string; storagePath: string; orgId: string | null }> = []
  for (const doc of snap.docs) {
    const d = doc.data()
    if (d.deleted === true) continue
    if (typeof d.storagePath === 'string' && d.storagePath) {
      paths.add(d.storagePath)
      docs.push({
        id: doc.id,
        storagePath: d.storagePath,
        orgId: typeof d.orgId === 'string' ? d.orgId : null,
      })
    }
  }
  return { paths, docs }
}

export const GET = withAuth('admin', async () => {
  try {
    const bucket = getStorage(getAdminApp()).bucket()
    const [files] = await bucket.getFiles({ maxResults: SCAN_CAP })
    const scanned = files.length
    const truncated = scanned >= SCAN_CAP

    const { paths: uploadPaths, docs: uploadDocs } = await loadUploadPaths()

    const storageNames = new Set<string>()
    const orphans: Array<{ path: string; sizeBytes: number; updated: string | null }> = []
    for (const f of files) {
      storageNames.add(f.name)
      if (!uploadPaths.has(f.name)) {
        const sizeRaw = f.metadata?.size
        const sizeBytes = typeof sizeRaw === 'string' ? Number(sizeRaw) || 0 : typeof sizeRaw === 'number' ? sizeRaw : 0
        const updated = typeof f.metadata?.updated === 'string' ? f.metadata.updated : null
        orphans.push({ path: f.name, sizeBytes, updated })
      }
    }

    // missing blobs: uploads docs whose storagePath wasn't in the listed objects.
    // Only meaningful if the scan wasn't truncated.
    const missingBlobs = uploadDocs
      .filter((d) => !storageNames.has(d.storagePath))
      .map((d) => ({ id: d.id, storagePath: d.storagePath, orgId: d.orgId }))

    return apiSuccess({
      orphans,
      missingBlobs,
      scanCap: SCAN_CAP,
      scanned,
      truncated,
      storageAvailable: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[storage/orphans] Storage enumeration error:', message)
    return apiSuccess({
      orphans: [],
      missingBlobs: [],
      scanCap: SCAN_CAP,
      scanned: 0,
      truncated: false,
      storageAvailable: false,
      note: 'Storage enumeration requires Storage admin access — credentials unavailable or denied',
    })
  }
})

export const DELETE = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  let body: { path?: unknown; confirm?: unknown }
  try {
    body = (await req.json()) as { path?: unknown; confirm?: unknown }
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const path = typeof body.path === 'string' ? body.path : ''
  const confirm = typeof body.confirm === 'string' ? body.confirm : ''
  if (!path) return apiError('path required', 400)
  if (confirm !== path) return apiError('confirm must exactly equal path', 400)

  try {
    const bucket = getStorage(getAdminApp()).bucket()
    await bucket.file(path).delete()
    return apiSuccess({ deleted: true, path })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[storage/orphans] delete error:', message)
    return apiError('Storage not available', 503)
  }
})
