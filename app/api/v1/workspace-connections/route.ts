import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { actorRole, orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_CONNECTION_COLLECTION, normalizeWorkspaceConnectionInput, serializeWorkspaceConnection } from '@/lib/workspace-os/connections'
import { X_MCP_CLIENT_CONFIG, X_MCP_CONNECTION_KEY, X_MCP_PROVIDER } from '@/lib/workspace-os/xMcp'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch, resolved)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const snapshot = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).where('orgId', '==', orgId).get()
  const status = searchParams.get('status')
  const provider = searchParams.get('provider')
  const owner = searchParams.get('owner')
  const connections = snapshot.docs
    .map((doc) => serializeWorkspaceConnection(doc.id, doc.data()))
    .filter((item) => item.deleted !== true)
    .filter((item) => !status || item.status === status)
    .filter((item) => !provider || item.provider === provider)
    .filter((item) => owner !== 'me' || item.ownerUserId === user.uid || (item.owner?.type === 'user' && item.owner.id === user.uid))
  return apiSuccess(connections)
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = (await req.json()) as Record<string, unknown>
  const resolved = resolveOrgId(req, user, body)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch, resolved)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  let connection
  try { connection = normalizeWorkspaceConnectionInput(body, orgId) } catch (err) { return apiError(err instanceof Error ? err.message : 'Invalid workspace connection payload', 400) }
  if (connection.provider === X_MCP_PROVIDER) {
    connection = {
      ...connection,
      connectionKey: connection.connectionKey ?? X_MCP_CONNECTION_KEY,
      ownerUserId: connection.ownerUserId ?? user.uid,
      owner: connection.owner?.id ? connection.owner : { type: 'user' as const, id: user.uid },
      connectionType: 'user_oauth' as const,
      tokenStatus: connection.tokenStatus === 'unknown' ? 'user_authorization_required' : connection.tokenStatus,
      safeMetadata: {
        ...connection.safeMetadata,
        mcp: X_MCP_CLIENT_CONFIG,
        userOwnedPermissions: true,
        sharedPlatformTokenStored: false,
      },
    }
  }
  if (connection.provider === X_MCP_PROVIDER) {
    const existingSnapshot = await adminDb
      .collection(WORKSPACE_CONNECTION_COLLECTION)
      .where('orgId', '==', orgId)
      .where('provider', '==', X_MCP_PROVIDER)
      .where('connectionKey', '==', connection.connectionKey ?? X_MCP_CONNECTION_KEY)
      .get()
      .catch(() => null)
    const existing = existingSnapshot?.docs?.find((doc) => {
      const data = doc.data()
      return data.deleted !== true && (data.ownerUserId === user.uid || (data.owner?.type === 'user' && data.owner.id === user.uid))
    })
    if (existing) {
      await existing.ref.update({
        ...connection,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return apiSuccess({ id: existing.id, existing: true })
    }
  }

  const ref = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).add({
    ...connection,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  logActivity({ orgId, type: 'workspace_connection_created', actorId: user.uid, actorName: user.uid, actorRole: actorRole(user), description: `Created Workspace connection: "${connection.displayName}"`, entityId: ref.id, entityType: 'workspace_connection', entityTitle: connection.displayName }).catch(() => {})
  return apiSuccess({ id: ref.id }, 201)
})
