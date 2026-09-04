/**
 * POST /api/v1/bots/[botId]/routines/[routineId]/run — manual fire
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { isValidAgentId } from '@/lib/agents/types'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import {
  assertCanManageRoutine,
  fireRoutineById,
  getRoutine,
  RoutineAuthError,
  RoutineFlagDisabledError,
} from '@/lib/routines/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ botId: string; routineId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { botId, routineId } = await (ctx as Ctx).params
  if (!isValidAgentId(botId)) return apiError('Invalid botId', 400)

  const orgIdParam = req.nextUrl.searchParams.get('orgId')?.trim() || null
  const scope = resolveOrgScope(user, orgIdParam)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!clientCanAccessOrg(user, scope.orgId)) return apiError('Forbidden', 403)

  const routine = await getRoutine(routineId)
  if (!routine || routine.agentId !== botId || routine.orgId !== scope.orgId) {
    return apiError('Routine not found', 404)
  }

  try {
    await assertCanManageRoutine(user, routine)
    const run = await fireRoutineById(routineId, { kind: 'manual', userId: user.uid })
    return apiSuccess({ run }, 201)
  } catch (err) {
    if (err instanceof RoutineFlagDisabledError) return apiError('feature_disabled', 404)
    if (err instanceof RoutineAuthError) return apiError(err.message, err.status)
    return apiError(err instanceof Error ? err.message : String(err), 400)
  }
})
