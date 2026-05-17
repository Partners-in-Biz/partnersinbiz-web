import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { addSupportMessage, getSupportTicket, listSupportMessages } from '@/lib/support/store'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function assertAdminTicket(id: string, user: ApiUser) {
  const ticket = await getSupportTicket(id)
  if (!ticket) return { ok: false as const, response: apiError('Support ticket not found', 404) }
  if (user.allowedOrgIds?.length && !user.allowedOrgIds.includes(ticket.orgId)) {
    return { ok: false as const, response: apiError('Forbidden', 403) }
  }
  return { ok: true as const, ticket }
}

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await assertAdminTicket(id, user)
  if (!access.ok) return access.response
  const messages = await listSupportMessages(id)
  return apiSuccess(messages)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await assertAdminTicket(id, user)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  const messageBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!messageBody) return apiError('Message body is required', 400)

  const userDoc = await adminDb.collection('users').doc(user.uid).get()
  const data = userDoc.data() ?? {}
  const authorName =
    typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : typeof data.email === 'string' && data.email.trim()
        ? data.email.trim()
        : 'Partners in Biz'

  const result = await addSupportMessage({
    ticketId: id,
    orgId: access.ticket.orgId,
    authorId: user.uid,
    authorRole: 'admin',
    authorName,
    body: messageBody,
  })

  if (!result.ok) return apiError(result.error, 400)
  return apiSuccess({ id: result.id }, 201)
})
