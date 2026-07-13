import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { createSenderPolicy, listSenderPolicies, updateSenderPolicy } from '@/lib/email-marketing/sender-store'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (_req: NextRequest, _user, orgId) => {
  return apiSuccess({ policies: await listSenderPolicies(orgId) })
}))

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const policy = await createSenderPolicy(orgId, body, user.uid)
  return apiSuccess({ policy }, 201)
}))

export const PATCH = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('id is required', 400)
  const { id: _ignored, orgId: _orgId, ...patch } = body
  const policy = await updateSenderPolicy(orgId, id, patch, user.uid)
  return policy ? apiSuccess({ policy }) : apiError('Sender policy not found', 404)
}))
