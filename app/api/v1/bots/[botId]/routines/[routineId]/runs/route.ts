/**
 * GET /api/v1/bots/[botId]/routines/[routineId]/runs — run history
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { isValidAgentId } from '@/lib/agents/types'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { getRoutine, listRunsForRoutine } from '@/lib/routines/service'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ botId: string; routineId: string }> }

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
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

  if (routine.accessScope === 'personal') {
    if (user.uid !== routine.ownerUserId && user.role !== 'admin' && user.role !== 'ai') {
      return apiError('Forbidden', 403)
    }
  }

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '30')
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 100) : 30
  const runs = await listRunsForRoutine(routineId, limit)
  return apiSuccess({ runs, routineId, botId, orgId: scope.orgId })
})
