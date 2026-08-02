import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isChatContextKind, isOpaqueContextId } from '@/lib/chat-context/access'
import { chatContextRegistry } from '@/lib/chat-context/registry'
import { canAccessConversation, authorizeConversationProject } from '@/lib/conversations/access'
import { getConversation } from '@/lib/conversations/conversations'
import { sanitizeContextReferenceSeeds } from '@/lib/context-references/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ kind: string; id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const raw = await (ctx as RouteContext).params
  const kind = raw.kind.trim()
  const id = raw.id.trim()
  const artifactId = req.nextUrl.searchParams.get('artifactId')?.trim()
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim()
  const conversationId = req.nextUrl.searchParams.get('conversationId')?.trim()
  if (!isChatContextKind(kind)) return apiError('Unsupported context kind', 400)
  if (!isOpaqueContextId(id)) return apiError('Invalid context id', 400)
  if (projectId && (kind !== 'task' || !isOpaqueContextId(projectId))) return apiError('Invalid project id', 400)
  if (conversationId && !isOpaqueContextId(conversationId)) return apiError('Invalid conversation id', 400)
  if (artifactId && (!isOpaqueContextId(artifactId) || artifactId.split(':', 1)[0] !== id.split(':', 1)[0])) return apiError('Invalid artifact id', 400)

  let contextReference
  let authorisedConversationId: string | undefined
  if (conversationId) {
    const conversation = await getConversation(conversationId)
    if (!conversation || !canAccessConversation(user, conversation)) return apiError('Context unavailable', 404)
    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError('Context unavailable', 404)
    authorisedConversationId = conversationId
    // Workbench path IDs are deliberately opaque — recover the sealed binding
    // from the conversation when present. Other kinds (e.g. project) only need
    // the conversation id for conversation-scoped preview actions.
    contextReference = sanitizeContextReferenceSeeds(conversation.contextRefs ?? []).find((reference) => (
      reference.type === kind && reference.id === id && reference.metadata?.contextKind === 'workbench_path'
    ))
    if (!contextReference && kind === 'workspace_folder') {
      return apiError('Context unavailable', 404)
    }
  }

  const result = await chatContextRegistry.resolve({
    kind,
    id,
    ...(projectId ? { projectId } : {}),
    ...(authorisedConversationId ? { conversationId: authorisedConversationId } : {}),
    ...(contextReference ? { contextReference } : {}),
    artifactId,
    user,
  })
  if (!result.ok) {
    if (result.reason === 'forbidden' || result.reason === 'not_found') {
      return apiError('Context unavailable', 404)
    }
    return apiError(result.error, result.status)
  }
  if (artifactId) {
    const artifact = result.model.artifacts.find((candidate) => candidate.id === artifactId)
    if (!artifact) return apiError('Context unavailable', 404)
    return apiSuccess({ ...result.model, groups: [], attention: [], activity: [], artifacts: [artifact], ...(result.revision ? { revision: result.revision } : {}) })
  }
  return apiSuccess(result.revision ? { ...result.model, revision: result.revision } : result.model)
})
