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
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const updates = {
    status: typeof body.status === 'string' ? body.status : 'approved',
    approvalStatus: typeof body.approvalStatus === 'string' ? body.approvalStatus : 'approved',
    approvalGateTaskId: typeof body.approvalGateTaskId === 'string' ? body.approvalGateTaskId : connection.approvalGateTaskId,
    lastReviewedAt: new Date().toISOString(),
    lastReviewedBy: user.uid,
    ...lastActorFrom(user),
  }
  await ref.update(updates)
  return apiSuccess({ id, reviewed: true })
})
