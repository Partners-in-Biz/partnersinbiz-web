import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getConversation } from '@/lib/conversations/conversations'
import { getMessageModelCatalog } from '@/lib/messages/model-catalog'
import type { ApiUser } from '@/lib/api/types'
import { canAccessConversation } from '@/lib/conversations/access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId } = await (ctx as Params).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccessConversation(user, conversation)) return apiError('Forbidden', 403)

  const agentId = req.nextUrl.searchParams.get('agentId') ?? undefined
  const catalog = await getMessageModelCatalog({ conversation, user, agentId })
  return apiSuccess(catalog)
})
