import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'
import { createSenderIdentity, listSenderIdentities } from '@/lib/email-marketing/sender-store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (_req: NextRequest, _user, orgId) => {
  return apiSuccess({ identities: await listSenderIdentities(orgId) })
}))

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const identity = await createSenderIdentity(orgId, body, user.uid)
  return apiSuccess({ identity }, 201)
}))
