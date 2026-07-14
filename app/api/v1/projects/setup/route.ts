import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildProjectSetupPlan } from '@/lib/project-locations/setup'

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)
  if (body.mode !== 'full_client') {
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
    if (!orgId) return apiError('orgId is required', 400)
    if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  }
  try {
    const plan = buildProjectSetupPlan(body, { actorUserId: user.uid, actorRole: user.role })
    return apiSuccess({ plan }, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Project setup request is invalid'
    const status = /admin role required/.test(message) ? 403 : 400
    return apiError(message, status)
  }
})
