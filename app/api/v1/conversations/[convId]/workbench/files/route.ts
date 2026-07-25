import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'
import { resolveWorkbenchSyncTree } from '@/lib/messages/workbench/resolve-sync'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

/**
 * Phase 2a Files tab data source: serves the tree from the conversation's
 * bound project-sync manifest when one is available. `source: 'none'` tells
 * the client to keep rendering the Phase 1 event-derived tree instead.
 */
export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId } = await (ctx as Params).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccessConversation(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  const workspaceContext = conversation.workspaceContext
  const resolution = await resolveWorkbenchSyncTree({
    orgId: conversation.orgId,
    projectId: projectAuthorization.projectId,
    mappingId: workspaceContext?.mappingId ?? null,
  })

  return apiSuccess({
    source: resolution.source,
    tree: resolution.tree,
    revision: resolution.revision ?? null,
    requestId: resolution.requestId ?? null,
    replicaId: resolution.replicaId ?? null,
    entryCount: resolution.entryCount ?? null,
    runtime: {
      hasMapping: Boolean(workspaceContext?.mappingId),
      label: workspaceContext?.runtimeLabel ?? null,
      mappingLabel: workspaceContext?.mappingLabel ?? null,
      projectName: workspaceContext?.projectName ?? null,
      folderScope: workspaceContext?.folderScope ?? null,
      runtimeTarget: workspaceContext?.runtimeTarget ?? null,
    },
  })
})
