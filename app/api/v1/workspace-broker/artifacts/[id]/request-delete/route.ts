import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_ARTIFACT_COLLECTION, serializeWorkspaceArtifact } from '@/lib/workspace-os/artifacts'
import { createBrokerJob } from '@/lib/workspace-os/brokerRoute'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Workspace artifact not found', 404)
  const artifact = serializeWorkspaceArtifact(doc.id, doc.data() ?? {})
  if (artifact.deleted === true) return apiError('Workspace artifact not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? artifact.orgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== artifact.orgId) return apiError('Forbidden', 403)
  return createBrokerJob(req, user, 'request_delete', { artifactId: id, artifactTitle: artifact.title, artifactType: artifact.artifactType, visibility: artifact.visibility, connectionId: artifact.connectionId })
})
