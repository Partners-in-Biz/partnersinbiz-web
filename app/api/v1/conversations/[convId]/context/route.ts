import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canManageConversationContext } from '@/lib/conversations/access'
import { patchConversationContextRefs } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds } from '@/lib/context-references/types'
import { getConversation } from '@/lib/conversations/conversations'
import { adminDb } from '@/lib/firebase/admin'
import { autoLinkProjectToConversationComputer } from '@/lib/project-locations/auto-link-conversation-computer'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }
type ContextAction = 'add' | 'remove' | 'clear'

function actionFrom(value: unknown): ContextAction | null {
  return value === 'add' || value === 'remove' || value === 'clear' ? value : null
}

export const PATCH = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)
    if (!canManageConversationContext(user, conversation)) return apiError('Forbidden', 403)
    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)
    const action = actionFrom((body as Record<string, unknown>).action)
    if (!action) return apiError('action must be add, remove, or clear', 400)

    const seeds = sanitizeContextReferenceSeeds((body as Record<string, unknown>).refs)
    const contextRefs = await patchConversationContextRefs({
      convId,
      orgId: conversation.orgId,
      action,
      refs: seeds,
      currentRefs: conversation.contextRefs ?? [],
      user,
    })

    // When a project is pinned into a computer-bound chat, ensure a location
    // replica exists so the next agent turn can execute on that machine.
    const computerLinks: Array<{ projectId: string; linked: boolean; reason?: string; locationId?: string }> = []
    if (action === 'add' && conversation.workspaceContext?.runtimeTarget) {
      const projectIds = Array.from(new Set(
        seeds
          .filter((ref) => ref.type === 'project' && typeof ref.id === 'string' && ref.id.trim())
          .map((ref) => ref.id.trim()),
      ))
      for (const projectId of projectIds) {
        try {
          const projectSnap = await adminDb.collection('projects').doc(projectId).get()
          const projectFolderRelativePath = projectSnap.exists
            && typeof projectSnap.data()?.projectFolderRelativePath === 'string'
            ? String(projectSnap.data()?.projectFolderRelativePath)
            : null
          const linkResult = await autoLinkProjectToConversationComputer({
            projectId,
            orgId: conversation.orgId,
            actorUserId: user.uid,
            workspaceContext: conversation.workspaceContext,
            projectFolderRelativePath,
          })
          computerLinks.push(linkResult.linked
            ? { projectId, linked: true, locationId: linkResult.locationId }
            : { projectId, linked: false, reason: linkResult.reason })
        } catch (error) {
          if (process.env.NODE_ENV !== 'test') {
            console.error('[conversation-context-auto-link-computer]', { convId, projectId, error })
          }
          computerLinks.push({ projectId, linked: false, reason: 'auto_link_error' })
        }
      }
    }

    return apiSuccess({
      contextRefs,
      ...(computerLinks.length > 0 ? { computerLinks } : {}),
    })
  },
)
