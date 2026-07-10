import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { requireHermesProfileAccess } from '@/lib/hermes/server'
import { conversationDoc, getConversation, listMessages } from '@/lib/hermes/conversations'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; convId: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId, convId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId || conv.profile !== access.link.profile) {
    return apiError('Conversation not found', 404)
  }
  if (!conv.participantUids.includes(user.uid)) return apiError('Forbidden', 403)
  const messages = await listMessages(convId)
  return apiSuccess({ conversation: conv, messages })
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, convId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId || conv.profile !== access.link.profile) {
    return apiError('Conversation not found', 404)
  }
  if (!conv.participantUids.includes(user.uid)) return apiError('Forbidden', 403)
  if (conv.ownerUid !== user.uid && !isSuperAdmin(user)) return apiError('Only the conversation owner can update it', 403)
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200)
  if (typeof body.archived === 'boolean') patch.archived = body.archived
  await conversationDoc(convId).update(patch)
  return apiSuccess({ ok: true })
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { orgId, convId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId || conv.profile !== access.link.profile) {
    return apiError('Conversation not found', 404)
  }
  if (conv.ownerUid !== user.uid && !isSuperAdmin(user)) {
    return apiError('Only the conversation owner or a super administrator can delete it', 403)
  }
  await conversationDoc(convId).delete()
  return apiSuccess({ ok: true })
})
