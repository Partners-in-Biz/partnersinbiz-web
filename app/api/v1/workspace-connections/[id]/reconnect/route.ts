import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_CONNECTION_COLLECTION, serializeWorkspaceConnection } from '@/lib/workspace-os/connections'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Workspace connection not found', 404)
  const connection = serializeWorkspaceConnection(doc.id, doc.data() ?? {})
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? connection.orgId, resolved.mismatch)
  if (accessError) return accessError
  const reconnectInstructions = connection.reconnectInstructions || 'Reconnect this Workspace connection through the approved Google OAuth/service-account runbook. Raw tokens are never returned by the API.'
  await ref.update({ tokenStatus: 'needs_reconnect', reconnectInstructions, ...lastActorFrom(user) })
  return apiSuccess({ id, tokenStatus: 'needs_reconnect', reconnectInstructions })
})
