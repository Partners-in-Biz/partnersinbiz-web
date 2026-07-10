import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canManageConversationContext } from '@/lib/conversations/access'
import { patchConversationContextRefs } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds } from '@/lib/context-references/types'
import { getConversation } from '@/lib/conversations/conversations'

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

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)
    const action = actionFrom((body as Record<string, unknown>).action)
    if (!action) return apiError('action must be add, remove, or clear', 400)

    const contextRefs = await patchConversationContextRefs({
      convId,
      orgId: conversation.orgId,
      action,
      refs: sanitizeContextReferenceSeeds((body as Record<string, unknown>).refs),
      currentRefs: conversation.contextRefs ?? [],
      user,
    })

    return apiSuccess({ contextRefs })
  },
)
