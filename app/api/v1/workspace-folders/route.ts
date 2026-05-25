import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  WORKSPACE_FOLDER_COLLECTION,
  canReadWorkspaceFolder,
  normalizeWorkspaceFolderInput,
  serializeWorkspaceFolder,
  workspaceFolderMatchesLookup,
  type WorkspaceFolder,
} from '@/lib/workspace-folders/model'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

function requestedOrgId(req: NextRequest, user: { role: string; orgId?: string; orgIds?: string[] }, body?: Record<string, unknown>): string | null {
  if (user.role === 'client') return user.orgId ?? user.orgIds?.[0] ?? null
  const { searchParams } = new URL(req.url)
  const fromBody = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
  return fromBody || searchParams.get('orgId') || req.headers.get('x-org-id')
}

function sortFolders(a: WorkspaceFolder & { id: string }, b: WorkspaceFolder & { id: string }): number {
  const bySort = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (bySort !== 0) return bySort
  return a.name.localeCompare(b.name)
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = requestedOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const filters = {
    resourceType: searchParams.get('resourceType'),
    resourceId: searchParams.get('resourceId'),
    parentId: searchParams.has('parentId') ? searchParams.get('parentId') : undefined,
    tag: searchParams.get('tag'),
  }

  const snapshot = await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).where('orgId', '==', orgId).get()
  const folders = snapshot.docs
    .map((doc) => serializeWorkspaceFolder(doc.id, doc.data()))
    .filter((folder) => folder.deleted !== true)
    .filter((folder) => canReadWorkspaceFolder(folder, user))
    .filter((folder) => workspaceFolderMatchesLookup(folder, filters))
    .sort(sortFolders)

  return apiSuccess(folders)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json()) as Record<string, unknown>
  const orgId = requestedOrgId(req, user, body)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  let folder: WorkspaceFolder
  try {
    folder = normalizeWorkspaceFolderInput(body, orgId)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Invalid workspace folder payload', 400)
  }

  const ref = await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).add({
    ...folder,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  logActivity({
    orgId,
    type: 'workspace_folder_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Created workspace folder mapping: "${folder.name}"`,
    entityId: ref.id,
    entityType: 'workspace_folder',
    entityTitle: folder.name,
  }).catch(() => {})

  return apiSuccess({ id: ref.id }, 201)
})
