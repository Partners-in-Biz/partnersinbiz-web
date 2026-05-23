import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { WORKSPACE_FOLDER_COLLECTION, serializeWorkspaceFolder } from '@/lib/workspace-folders/model'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const reqOrgId = new URL(req.url).searchParams.get('orgId') || req.headers.get('x-org-id')
  const ref = adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Workspace folder not found', 404)

  const folder = serializeWorkspaceFolder(doc.id, doc.data() ?? {})
  if (folder.deleted === true) return apiError('Workspace folder not found', 404)
  if ((reqOrgId && reqOrgId !== folder.orgId) || !canAccessOrg(user, folder.orgId)) return apiError('Forbidden', 403)

  const now = new Date().toISOString()
  await ref.update({
    syncState: {
      ...folder.syncState,
      status: 'not_configured',
      lastAttemptAt: now,
      error: 'Manual resync queue is not configured yet.',
    },
    audit: {
      ...folder.audit,
      notes: folder.audit.notes ?? 'Manual resync requested before a sync worker was configured.',
    },
    ...lastActorFrom(user),
  })

  logActivity({
    orgId: folder.orgId,
    type: 'workspace_folder_resync_requested',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : 'admin',
    description: `Requested manual resync for workspace folder mapping: "${folder.name}"`,
    entityId: id,
    entityType: 'workspace_folder',
    entityTitle: folder.name,
  }).catch(() => {})

  return apiSuccess({
    queued: false,
    folderId: id,
    syncStatus: 'not_configured',
    message: 'Manual resync is not configured for this folder yet.',
  })
})
