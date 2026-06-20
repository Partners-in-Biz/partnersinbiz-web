import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { hasValidCreativeCanvasRuntimeKey, submitCreativeCanvasRunToHermes } from '@/lib/creative-canvas/hermes-runtime-bridge'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!process.env.HIGGSFIELD_RUNTIME_API_KEY) {
    return apiError('Higgsfield runtime API key is not configured', 503)
  }
  if (!hasValidCreativeCanvasRuntimeKey(req.headers.get('authorization'))) {
    return apiError('Unauthorized', 401)
  }

  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)

  const result = await submitCreativeCanvasRunToHermes(body)
  return apiSuccess(result)
}
