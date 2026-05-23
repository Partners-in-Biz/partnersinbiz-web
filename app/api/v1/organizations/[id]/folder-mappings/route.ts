import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { normalizeWorkspaceFolderMappings } from '@/lib/workspace-folder-mappings'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadOrg(id: string, user: any) {
  const ref = adminDb.collection('organizations').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return { error: apiError('Organisation not found', 404) }
  if (!canAccessOrg(user, id)) return { error: apiError('Forbidden', 403) }
  return { ref, data: doc.data() ?? {} }
}

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadOrg(id, user)
  if (loaded.error) return loaded.error

  const settings = (loaded.data.settings ?? {}) as Record<string, unknown>
  const folders = normalizeWorkspaceFolderMappings(settings.workspaceFolderMappings)
  return apiSuccess(folders)
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadOrg(id, user)
  if (loaded.error) return loaded.error

  const body = await req.json().catch(() => ({}))
  const incoming = Array.isArray(body) ? body : body.folderMappings
  const folders = normalizeWorkspaceFolderMappings(incoming).map(folder => ({
    ...folder,
    resourceId: folder.resourceId || id,
    updatedAt: new Date().toISOString(),
  }))

  await loaded.ref!.update({
    settings: {
      ...((loaded.data.settings ?? {}) as Record<string, unknown>),
      workspaceFolderMappings: folders,
    },
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess(folders)
})
