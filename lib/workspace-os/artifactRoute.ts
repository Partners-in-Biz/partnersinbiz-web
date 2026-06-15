import type { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_ARTIFACT_COLLECTION, serializeWorkspaceArtifact, type WorkspaceArtifact } from '@/lib/workspace-os/artifacts'

export async function loadWorkspaceArtifactForBroker(req: NextRequest, user: ApiUser, artifactId: string): Promise<{ artifact: WorkspaceArtifact & { id: string } } | { response: Response }> {
  const ref = adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).doc(artifactId)
  const doc = await ref.get()
  if (!doc.exists) return { response: apiError('Workspace artifact not found', 404) }
  const artifact = serializeWorkspaceArtifact(doc.id, doc.data() ?? {})
  if (artifact.deleted === true) return { response: apiError('Workspace artifact not found', 404) }

  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId ?? artifact.orgId, resolved.mismatch, resolved)
  if (accessError) return { response: accessError }
  if (resolved.orgId && resolved.orgId !== artifact.orgId) return { response: apiError('Forbidden', 403) }

  return { artifact }
}

export function brokerArtifactDefaults(artifact: WorkspaceArtifact & { id: string }) {
  return {
    orgId: artifact.orgId,
    artifactId: artifact.id,
    artifactTitle: artifact.title,
    artifactType: artifact.artifactType,
    visibility: artifact.visibility,
    connectionId: artifact.connectionId,
    projectId: artifact.projectId,
    taskId: artifact.taskId,
    clientDocumentId: artifact.clientDocumentId,
    sourceDocumentId: artifact.sourceDocumentId,
    sourceResearchItemId: artifact.sourceResearchItemId,
  }
}
