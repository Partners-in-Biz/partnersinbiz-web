/**
 * POST /api/v1/integrations/linear/webhook?orgId=…
 */
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { fanoutRoutineEvent } from '@/lib/routines/event-fanout'
import { resolveIntegrationSecret, verifyLinearSignature } from '@/lib/routines/integrations'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('orgId')?.trim()
  if (!orgId) return apiError('orgId query required', 400)
  if (!(await orgFeatureFlagEnabled(orgId, 'botRoutinesEnabled'))) {
    return apiError('feature_disabled', 404)
  }

  const secret = await resolveIntegrationSecret(orgId, 'linear')
  if (!secret) return apiError('Linear integration not configured', 404)

  const body = await req.text()
  if (!verifyLinearSignature(secret, body, req.headers.get('linear-signature'))) {
    return apiError('Unauthorized', 401)
  }

  let parsed: Record<string, unknown> = {}
  try {
    parsed = body ? JSON.parse(body) as Record<string, unknown> : {}
  } catch {
    parsed = {}
  }

  const action = typeof parsed.action === 'string' ? parsed.action : 'update'
  const eventId = typeof parsed.webhookId === 'string'
    ? `${parsed.webhookId}_${action}`
    : createHash('sha256').update(body).digest('hex').slice(0, 24)

  const result = await fanoutRoutineEvent(orgId, {
    eventId,
    source: 'linear',
    summary: `Linear ${action}`,
    filter: { action },
    data: parsed,
  })

  return apiSuccess({ ok: true, ...result })
}
