import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'
import { getAdminApp } from '@/lib/firebase/admin'
import { findManifestFile, normalizeManifestPath } from '@/lib/messages/workbench/manifest-tree'
import { resolveWorkbenchSyncManifest } from '@/lib/messages/workbench/resolve-sync'
import { projectSyncObjectPath } from '@/lib/project-sync/storage'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

/** Text preview cap: keeps this endpoint fast and avoids inlining large binaries as "text". */
const MAX_PREVIEW_BYTES = 512 * 1024

/**
 * Best-effort binary sniff: a NUL byte in the first few KB, or a large share
 * of non-printable bytes, is treated as "not safely previewable as text".
 * Good enough for the common cases (images, archives, compiled binaries)
 * without pulling in a MIME-sniffing dependency.
 */
function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000))
  if (sample.includes(0)) return true
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue
    if (byte < 0x20 || byte === 0x7f) suspicious += 1
  }
  return sample.length > 0 && suspicious / sample.length > 0.1
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId } = await (ctx as Params).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccessConversation(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  const projectId = projectAuthorization.projectId
  if (!projectId) return apiError('This conversation is not bound to a project workspace', 400)

  const rawPath = req.nextUrl.searchParams.get('path') ?? ''
  const relativePath = normalizeManifestPath(rawPath)
  if (!relativePath) return apiError('A valid relative file path is required', 400)

  const resolution = await resolveWorkbenchSyncManifest({
    orgId: conversation.orgId,
    projectId,
    mappingId: conversation.workspaceContext?.mappingId ?? null,
  })
  if (resolution.source !== 'sync' || !resolution.manifest) {
    return apiError('No synced file manifest is available for this conversation yet', 404)
  }

  const entry = findManifestFile(resolution.manifest.entries, relativePath)
  if (!entry) return apiError('File not found in the synced manifest', 404)
  if (entry.size > MAX_PREVIEW_BYTES) {
    return apiError(`File is too large to preview (max ${Math.floor(MAX_PREVIEW_BYTES / 1024)}KB)`, 413)
  }

  const objectPath = projectSyncObjectPath({ orgId: conversation.orgId, projectId, sha256: entry.sha256 })
  let buffer: Buffer
  try {
    const [downloaded] = await getStorage(getAdminApp()).bucket().file(objectPath).download()
    buffer = downloaded
  } catch {
    return apiError('File content not found in storage', 404)
  }

  if (looksBinary(buffer)) {
    return apiError('File appears to be binary and cannot be previewed as text', 415)
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
