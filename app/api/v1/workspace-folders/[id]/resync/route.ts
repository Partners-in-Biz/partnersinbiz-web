import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { WORKSPACE_FOLDER_COLLECTION, serializeWorkspaceFolder } from '@/lib/workspace-folders/model'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'
const WORKSPACE_FOLDER_SYNC_REQUEST_COLLECTION = 'workspace_folder_sync_requests'

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
  const hasOpenConflicts = folder.syncState.conflictCount > 0 || folder.audit.conflictStatus === 'open'
  const requestStatus = hasOpenConflicts ? 'blocked_conflict' : 'planned'
  const requestRef = adminDb.collection(WORKSPACE_FOLDER_SYNC_REQUEST_COLLECTION).doc()
  await requestRef.set({
    folderId: id,
    orgId: folder.orgId,
    requestedBy: user.uid,
    requestedAt: now,
    status: requestStatus,
    plan: {
      sourceOfTruth: folder.sourceOfTruth,
      syncMode: folder.syncMode,
      targets: folder.syncTargets,
      driveFolderId: folder.drive.folderId,
      vpsConfigured: Boolean(folder.paths.vpsPath),
      localConfigured: Boolean(folder.paths.localPathHint),
      conflictCount: folder.syncState.conflictCount,
      destructiveDeletes: false,
    },
    createdAt: FieldValue.serverTimestamp(),
    ...lastActorFrom(user),
  })
  const syncState = {
    ...folder.syncState,
    status: hasOpenConflicts ? 'conflict' as const : 'pending' as const,
    lastAttemptAt: now,
    error: null,
    lastRequestId: requestRef.id,
    lastRequestStatus: requestStatus,
  }
  await ref.update({
    syncState,
    audit: {
      ...folder.audit,
      notes: hasOpenConflicts
        ? 'Sync plan is blocked until open conflicts are resolved explicitly.'
        : folder.audit.notes,
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
    requestId: requestRef.id,
    folderId: id,
    requestStatus,
    syncStatus: syncState.status,
    syncState,
    message: hasOpenConflicts
      ? `Sync plan ${requestRef.id} recorded and blocked by ${folder.syncState.conflictCount} open conflict(s). No files were overwritten.`
      : `Sync plan ${requestRef.id} recorded. No file transfer or deletion runs until an approved executor claims this request.`,
  })
})
