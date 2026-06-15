import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_ARTIFACT_COLLECTION, canReadWorkspaceArtifact, serializeWorkspaceArtifact, workspaceArtifactMatchesLookup } from '@/lib/workspace-os/artifacts'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch, resolved)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const snapshot = await adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).where('orgId', '==', orgId).get()
  const filters = {
    resourceType: searchParams.get('resourceType'),
    resourceId: searchParams.get('resourceId'),
    projectId: searchParams.get('projectId'),
    taskId: searchParams.get('taskId'),
    workspaceFolderId: searchParams.get('workspaceFolderId'),
    type: searchParams.get('type'),
    visibility: searchParams.get('visibility'),
    status: searchParams.get('status'),
    q: searchParams.get('q'),
  }
  const artifacts = snapshot.docs
    .map((doc) => serializeWorkspaceArtifact(doc.id, doc.data()))
    .filter((item) => item.deleted !== true)
    .filter((item) => canReadWorkspaceArtifact(item, user))
    .filter((item) => workspaceArtifactMatchesLookup(item, filters))
    .sort((a, b) => a.title.localeCompare(b.title))
  return apiSuccess({ artifacts, lookup: { orgId, ...filters } })
})
