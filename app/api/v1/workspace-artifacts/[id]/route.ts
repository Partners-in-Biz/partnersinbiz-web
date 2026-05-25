import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_ARTIFACT_COLLECTION, buildWorkspaceArtifactUpdate, canReadWorkspaceArtifact, serializeWorkspaceArtifact } from '@/lib/workspace-os/artifacts'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

async function loadArtifact(id: string) {
  const ref = adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return { ref, artifact: null }
  return { ref, artifact: serializeWorkspaceArtifact(doc.id, doc.data() ?? {}) }
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const { artifact } = await loadArtifact(id)
  if (!artifact || artifact.deleted === true) return apiError('Workspace artifact not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? artifact.orgId, resolved.mismatch)
  if (accessError) return accessError
  if ((resolved.orgId && resolved.orgId !== artifact.orgId) || !canReadWorkspaceArtifact(artifact, user)) return apiError('Forbidden', 403)
  return apiSuccess(artifact)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const { ref, artifact } = await loadArtifact(id)
  if (!artifact || artifact.deleted === true) return apiError('Workspace artifact not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? artifact.orgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== artifact.orgId) return apiError('Forbidden', 403)
  const body = (await req.json()) as Record<string, unknown>
  let updates
  try { updates = buildWorkspaceArtifactUpdate(body) } catch (err) { return apiError(err instanceof Error ? err.message : 'Invalid workspace artifact payload', 400) }
  await ref.update({ ...updates, ...lastActorFrom(user) })
  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const { ref, artifact } = await loadArtifact(id)
  if (!artifact || artifact.deleted === true) return apiError('Workspace artifact not found', 404)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? artifact.orgId, resolved.mismatch)
  if (accessError) return accessError
  if (resolved.orgId && resolved.orgId !== artifact.orgId) return apiError('Forbidden', 403)
  await ref.update({ lifecycleStatus: 'archived', deleted: true, ...lastActorFrom(user) })
  return apiSuccess({ id, archived: true })
})
