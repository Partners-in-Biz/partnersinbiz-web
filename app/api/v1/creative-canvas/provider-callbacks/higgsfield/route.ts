import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { completeCreativeCanvasProviderCallback } from '@/lib/creative-canvas/runs'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

const HIGGSFIELD_ACTOR: CreativeCanvasActor = {
  uid: 'provider:higgsfield',
  type: 'system',
}

function hasValidSecret(req: NextRequest): boolean {
  const expected = process.env.HIGGSFIELD_WEBHOOK_SECRET
  if (!expected) return false
  const supplied = req.headers.get('x-creative-canvas-provider-secret')
    ?? req.headers.get('x-higgsfield-webhook-secret')
  return supplied === expected
}

export async function POST(req: NextRequest) {
  if (!process.env.HIGGSFIELD_WEBHOOK_SECRET) {
    return apiError('Higgsfield webhook secret is not configured', 503)
  }
  if (!hasValidSecret(req)) return apiError('Invalid Higgsfield webhook secret', 401)

  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)

  const result = await completeCreativeCanvasProviderCallback({
    ...body,
    providerKey: 'higgsfield',
  }, HIGGSFIELD_ACTOR)
  return apiSuccess(result)
}
