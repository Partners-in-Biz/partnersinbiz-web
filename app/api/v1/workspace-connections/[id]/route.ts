import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_CONNECTION_COLLECTION, buildWorkspaceConnectionUpdate, serializeWorkspaceConnection } from '@/lib/workspace-os/connections'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

async function loadConnection(id: string) {
  const ref = adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return { ref, connection: null }
  return { ref, connection: serializeWorkspaceConnection(doc.id, doc.data() ?? {}) }
}

export const GET = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const { connection } = await loadConnection(id)
  if (!connection || connection.deleted === true) return apiError('Workspace connection not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? connection.orgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== connection.orgId) return apiError('Forbidden', 403)
  return apiSuccess(connection)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const { ref, connection } = await loadConnection(id)
  if (!connection || connection.deleted === true) return apiError('Workspace connection not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? connection.orgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== connection.orgId) return apiError('Forbidden', 403)
  const body = (await req.json()) as Record<string, unknown>
  let updates
  try { updates = buildWorkspaceConnectionUpdate(body) } catch (err) { return apiError(err instanceof Error ? err.message : 'Invalid workspace connection payload', 400) }
  await ref.update({ ...updates, ...lastActorFrom(user) })
  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const { ref, connection } = await loadConnection(id)
  if (!connection || connection.deleted === true) return apiError('Workspace connection not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? connection.orgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== connection.orgId) return apiError('Forbidden', 403)
  await ref.update({ status: 'retired', deleted: true, ...lastActorFrom(user) })
  return apiSuccess({ id, deleted: true })
})
