import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { actorRole, orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_CONNECTION_COLLECTION, normalizeWorkspaceConnectionInput, serializeWorkspaceConnection } from '@/lib/workspace-os/connections'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const snapshot = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).where('orgId', '==', orgId).get()
  const status = searchParams.get('status')
  const connections = snapshot.docs
    .map((doc) => serializeWorkspaceConnection(doc.id, doc.data()))
    .filter((item) => item.deleted !== true)
    .filter((item) => !status || item.status === status)
  return apiSuccess(connections)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json()) as Record<string, unknown>
  const resolved = resolveOrgId(req, user, body)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  let connection
  try { connection = normalizeWorkspaceConnectionInput(body, orgId) } catch (err) { return apiError(err instanceof Error ? err.message : 'Invalid workspace connection payload', 400) }
  const ref = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).add({
    ...connection,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  logActivity({ orgId, type: 'workspace_connection_created', actorId: user.uid, actorName: user.uid, actorRole: actorRole(user), description: `Created Workspace connection: "${connection.displayName}"`, entityId: ref.id, entityType: 'workspace_connection', entityTitle: connection.displayName }).catch(() => {})
  return apiSuccess({ id: ref.id }, 201)
})
