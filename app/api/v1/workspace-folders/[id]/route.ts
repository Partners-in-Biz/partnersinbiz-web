import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  WORKSPACE_FOLDER_COLLECTION,
  buildWorkspaceFolderUpdate,
  canReadWorkspaceFolder,
  serializeWorkspaceFolder,
} from '@/lib/workspace-folders/model'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function requestedOrgId(req: NextRequest): string | null {
  const { searchParams } = new URL(req.url)
  return searchParams.get('orgId') || req.headers.get('x-org-id')
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const doc = await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(id).get()
  if (!doc.exists) return apiError('Workspace folder not found', 404)
  const folder = serializeWorkspaceFolder(doc.id, doc.data() ?? {})
  if (folder.deleted === true) return apiError('Workspace folder not found', 404)
  if (!canAccessOrg(user, folder.orgId) || !canReadWorkspaceFolder(folder, user)) return apiError('Forbidden', 403)
  return apiSuccess(folder)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Workspace folder not found', 404)
  const existing = serializeWorkspaceFolder(doc.id, doc.data() ?? {})
  if (existing.deleted === true) return apiError('Workspace folder not found', 404)

  const reqOrgId = requestedOrgId(req)
  if ((reqOrgId && reqOrgId !== existing.orgId) || !canAccessOrg(user, existing.orgId)) {
    return apiError('Forbidden', 403)
  }

  const body = (await req.json()) as Record<string, unknown>
  if (body.orgId !== undefined && body.orgId !== existing.orgId) return apiError('orgId cannot be changed', 400)
  if (body.parentId === id) return apiError('parentId cannot reference the folder itself', 400)

  let updates
  try {
    updates = buildWorkspaceFolderUpdate(body)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Invalid workspace folder payload', 400)
  }

  await ref.update({ ...updates, ...lastActorFrom(user) })

  logActivity({
    orgId: existing.orgId,
    type: 'workspace_folder_updated',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : 'admin',
    description: `Updated workspace folder mapping: "${updates.name ?? existing.name}"`,
    entityId: id,
    entityType: 'workspace_folder',
    entityTitle: String(updates.name ?? existing.name),
  }).catch(() => {})

  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Workspace folder not found', 404)
  const existing = serializeWorkspaceFolder(doc.id, doc.data() ?? {})
  if (existing.deleted === true) return apiError('Workspace folder not found', 404)
  const reqOrgId = requestedOrgId(req)
  if ((reqOrgId && reqOrgId !== existing.orgId) || !canAccessOrg(user, existing.orgId)) return apiError('Forbidden', 403)

  await ref.update({ deleted: true, ...lastActorFrom(user) })
  return apiSuccess({ id, deleted: true })
})
