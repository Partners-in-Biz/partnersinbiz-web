import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { deleteSenderIdentity, getSenderIdentity, updateSenderIdentity } from '@/lib/email-marketing/sender-store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', withTenant(async (_req: NextRequest, _user, orgId, context) => {
  const { id } = await (context as RouteContext).params
  const identity = await getSenderIdentity(orgId, id)
  return identity ? apiSuccess({ identity }) : apiError('Sender identity not found', 404)
}))

export const PATCH = withAuth('client', withTenant(async (req: NextRequest, user, orgId, context) => {
  const { id } = await (context as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const identity = await updateSenderIdentity(orgId, id, body, user.uid)
  return identity ? apiSuccess({ identity }) : apiError('Sender identity not found', 404)
}))

export const DELETE = withAuth('client', withTenant(async (_req: NextRequest, user, orgId, context) => {
  const { id } = await (context as RouteContext).params
  const deleted = await deleteSenderIdentity(orgId, id, user.uid)
  return deleted ? apiSuccess({ id, deleted: true }) : apiError('Sender identity not found', 404)
}))
