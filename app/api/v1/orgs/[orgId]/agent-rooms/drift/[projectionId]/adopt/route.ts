import { NextRequest } from 'next/server'
import { adoptProjectionDrift } from '@/lib/agent-rooms/projection'
import { assertCanManageAgentRooms } from '@/lib/agent-rooms/service'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; projectionId: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId, projectionId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'agentRoomsEnabled'))) return apiError('feature_disabled', 404)
  try {
    await assertCanManageAgentRooms(user, orgId)
  } catch {
    return apiError('Forbidden', 403)
  }

  try {
    const result = await adoptProjectionDrift({
      orgId,
      projectionId,
      actorUserId: user.uid,
    })
    return apiSuccess({ projection: result.projection, roomIds: result.roomIds })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'agent rooms: adopt failed'
    if (message.includes('not found')) return apiError(message, 404)
    if (message.startsWith('agent rooms:')) return apiError(message, 400)
    throw error
  }
})
