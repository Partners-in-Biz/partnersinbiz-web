import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getCreativeCanvasHermesRunStatus, hasValidCreativeCanvasRuntimeKey } from '@/lib/creative-canvas/hermes-runtime-bridge'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ runId: string }> }

export async function GET(req: NextRequest, context: RouteContext) {
  if (!process.env.HIGGSFIELD_RUNTIME_API_KEY) {
    return apiError('Higgsfield runtime API key is not configured', 503)
  }
  if (!hasValidCreativeCanvasRuntimeKey(req.headers.get('authorization'))) {
    return apiError('Unauthorized', 401)
  }

  const { runId } = await context.params
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required', 400)

  const result = await getCreativeCanvasHermesRunStatus(orgId, runId)
  return apiSuccess(result)
}
