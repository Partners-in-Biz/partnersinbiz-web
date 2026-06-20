import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import {
  listCreativeCanvasRuns,
  queueCreativeCanvasProofBatchRuns,
} from '@/lib/creative-canvas/runs'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

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

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  try {
    const canvas = await getCreativeCanvas(id, orgId)
    if (!canvas) return apiError('Creative canvas not found', 404)
    const runs = await listCreativeCanvasRuns(id, orgId)
    const result = await queueCreativeCanvasProofBatchRuns(canvas, orgId, actorFromUser(user), runs)
    return apiSuccess(result, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Creative canvas proof batch queue failed', 400)
  }
})
