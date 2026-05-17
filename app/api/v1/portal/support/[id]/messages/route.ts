import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { addSupportMessage, getSupportTicket, listSupportMessages } from '@/lib/support/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function assertPortalTicket(id: string, uid: string, orgId: string) {
  const ticket = await getSupportTicket(id)
  if (!ticket) return { ok: false as const, response: apiError('Support ticket not found', 404) }
  if (ticket.orgId !== orgId || ticket.createdBy !== uid) {
    return { ok: false as const, response: apiError('Forbidden', 403) }
  }
  return { ok: true as const, ticket }
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, uid: string, orgId: string, _role, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await assertPortalTicket(id, uid, orgId)
  if (!access.ok) return access.response
  const messages = await listSupportMessages(id)
  return apiSuccess(messages)
})

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, _role, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await assertPortalTicket(id, uid, orgId)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  const messageBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!messageBody) return apiError('Message body is required', 400)

  const userDoc = await adminDb.collection('users').doc(uid).get()
  const user = userDoc.data() ?? {}
  const authorName =
    typeof user.name === 'string' && user.name.trim()
      ? user.name.trim()
      : typeof user.displayName === 'string' && user.displayName.trim()
        ? user.displayName.trim()
        : 'Client'

  const result = await addSupportMessage({
    ticketId: id,
    orgId,
    authorId: uid,
    authorRole: 'client',
    authorName,
    body: messageBody,
  })

  if (!result.ok) return apiError(result.error, 400)
  return apiSuccess({ id: result.id }, 201)
})
