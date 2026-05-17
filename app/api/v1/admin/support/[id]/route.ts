import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getSupportTicket, SUPPORT_TICKETS_COLLECTION, validateSupportPatch } from '@/lib/support/store'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const ticket = await getSupportTicket(id)
  if (!ticket) return apiError('Support ticket not found', 404)
  if (user.allowedOrgIds?.length && !user.allowedOrgIds.includes(ticket.orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const parsed = validateSupportPatch(body as Record<string, unknown>)
  if (!parsed.ok) return apiError(parsed.error, 400)

  await adminDb.collection(SUPPORT_TICKETS_COLLECTION).doc(id).update(parsed.value)
  return apiSuccess({ id, updated: Object.keys(parsed.value) })
})
