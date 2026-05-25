import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { actorRole, orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_ARTIFACT_COLLECTION, normalizeWorkspaceArtifactInput } from '@/lib/workspace-os/artifacts'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json()) as Record<string, unknown>
  const resolved = resolveOrgId(req, user, body)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  let artifact
  try { artifact = normalizeWorkspaceArtifactInput(body, orgId) } catch (err) { return apiError(err instanceof Error ? err.message : 'Invalid workspace artifact payload', 400) }
  const ref = await adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).add({
    ...artifact,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  logActivity({ orgId, type: 'workspace_artifact_linked', actorId: user.uid, actorName: user.uid, actorRole: actorRole(user), description: `Linked Workspace artifact: "${artifact.title}"`, entityId: ref.id, entityType: 'workspace_artifact', entityTitle: artifact.title }).catch(() => {})
  return apiSuccess({ id: ref.id }, 201)
})
