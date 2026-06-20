import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { retryCreativeCanvasProviderRun } from '@/lib/creative-canvas/runs'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.role === 'ai' && user.agentId ? `agent:${user.agentId}` : user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { runId } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  try {
    const run = await retryCreativeCanvasProviderRun(runId, orgId, actorFromUser(user))
    return apiSuccess({ run })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas run retry failed', 400)
  }
})
