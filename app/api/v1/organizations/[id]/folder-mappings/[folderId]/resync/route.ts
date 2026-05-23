import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { normalizeWorkspaceFolderMappings } from '@/lib/workspace-folder-mappings'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; folderId: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id, folderId } = await (ctx as RouteContext).params
  const orgRef = adminDb.collection('organizations').doc(id)
  const doc = await orgRef.get()
  if (!doc.exists) return apiError('Organisation not found', 404)
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  const data = doc.data() ?? {}
  const settings = (data.settings ?? {}) as Record<string, unknown>
  const folders = normalizeWorkspaceFolderMappings(settings.workspaceFolderMappings)
  const folder = folders.find(item => item.id === folderId)
  if (!folder) return apiError('Folder mapping not found', 404)

  const now = new Date().toISOString()
  const updatedFolders = folders.map(item => item.id === folderId
    ? { ...item, syncStatus: 'not_configured' as const, lastAuditAt: now, updatedAt: now }
    : item,
  )

  await orgRef.update({
    settings: { ...settings, workspaceFolderMappings: updatedFolders },
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({
    queued: false,
    folderId,
    syncStatus: 'not_configured',
    message: 'Manual resync is not configured for this folder yet.',
  })
})
