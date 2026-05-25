import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  WORKSPACE_FOLDER_COLLECTION,
  canReadWorkspaceFolder,
  serializeWorkspaceFolder,
  workspaceFolderMatchesLookup,
  type WorkspaceFolder,
} from '@/lib/workspace-folders/model'

export const dynamic = 'force-dynamic'

function sortFolders(a: WorkspaceFolder & { id: string }, b: WorkspaceFolder & { id: string }): number {
  const bySort = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (bySort !== 0) return bySort
  return a.name.localeCompare(b.name)
}

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId') || req.headers.get('x-org-id') || user.orgId
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const lookup = {
    orgId,
    resourceType: searchParams.get('resourceType'),
    resourceId: searchParams.get('resourceId'),
    parentId: searchParams.has('parentId') ? searchParams.get('parentId') : null,
    tag: searchParams.get('tag'),
  }

  const snapshot = await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).where('orgId', '==', orgId).get()
  const folders = snapshot.docs
    .map((doc) => serializeWorkspaceFolder(doc.id, doc.data()))
    .filter((folder) => folder.deleted !== true)
    .filter((folder) => canReadWorkspaceFolder(folder, user))
    .filter((folder) => workspaceFolderMatchesLookup(folder, lookup))
    .sort(sortFolders)

  return apiSuccess({ lookup, folders })
})
