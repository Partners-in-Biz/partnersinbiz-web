/**
 * GET   /api/v1/conversations/[convId] — fetch a single conversation
 * PATCH /api/v1/conversations/[convId] — update title or archived flag
 * DELETE /api/v1/conversations/[convId] — permanently delete a conversation
 *
 * Auth: participant in the conversation OR admin role
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { logActivity } from '@/lib/activity/log'
import {
  deleteConversation,
  getConversation,
  patchConversation,
} from '@/lib/conversations/conversations'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

/** Verify the caller is a participant or has admin/ai role. */
function canAccess(user: ApiUser, participantUids: string[]): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  return participantUids.includes(user.uid)
}

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccess(user, conversation.participantUids)) {
      return apiError('Forbidden', 403)
    }

    return apiSuccess({ conversation })
  },
)

export const PATCH = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccess(user, conversation.participantUids)) {
      return apiError('Forbidden', 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const patch: { title?: string; archived?: boolean } = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') return apiError('title must be a string', 400)
      patch.title = body.title
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') return apiError('archived must be a boolean', 400)
      patch.archived = body.archived
    }
    if (patch.archived === true) {
      const archiveAccess = await assertUserCanPerformOrganizationModuleAction(
        user,
        conversation.orgId,
        'messages',
        'archive',
        'Conversation archive is disabled for your organisation role',
      )
      if (!archiveAccess.ok) return apiError(archiveAccess.error, archiveAccess.status)
    }

    if (Object.keys(patch).length === 0) {
      return apiError('Nothing to update — supply title and/or archived', 400)
    }

    await patchConversation(convId, patch)

    // Return the updated doc
    const updated = await getConversation(convId)
    return apiSuccess({ conversation: updated })
  },
)

export const DELETE = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)

    if (!canAccess(user, conversation.participantUids) || !canAccessOrg(user, conversation.orgId)) {
      return apiError('Forbidden', 403)
    }

    await logActivity({
      orgId: conversation.orgId,
      type: 'conversation_deleted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : 'admin',
      description: `Deleted conversation ${convId}`,
      entityId: convId,
      entityType: 'conversation',
      entityTitle: conversation.title,
    })
    await deleteConversation(convId)
    return apiSuccess({ id: convId })
  },
)
