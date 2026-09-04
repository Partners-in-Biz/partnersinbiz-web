/**
 * POST /api/v1/integrations/slack/events?orgId=…
 */
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { fanoutRoutineEvent } from '@/lib/routines/event-fanout'
import { resolveIntegrationSecret, verifySlackSignature } from '@/lib/routines/integrations'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('orgId')?.trim()
  if (!orgId) return apiError('orgId query required', 400)
  if (!(await orgFeatureFlagEnabled(orgId, 'botRoutinesEnabled'))) {
    return apiError('feature_disabled', 404)
  }

  const secret = await resolveIntegrationSecret(orgId, 'slack')
  if (!secret) return apiError('Slack integration not configured', 404)

  const body = await req.text()
  if (!verifySlackSignature({
    secret,
    body,
    timestampHeader: req.headers.get('x-slack-request-timestamp'),
    signatureHeader: req.headers.get('x-slack-signature'),
  })) {
    return apiError('Unauthorized', 401)
  }

  let parsed: Record<string, unknown> = {}
  try {
    parsed = body ? JSON.parse(body) as Record<string, unknown> : {}
  } catch {
    parsed = {}
  }

  // Slack URL verification challenge
  if (parsed.type === 'url_verification' && typeof parsed.challenge === 'string') {
    return new Response(JSON.stringify({ challenge: parsed.challenge }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const event = parsed.event && typeof parsed.event === 'object'
    ? parsed.event as Record<string, unknown>
    : {}
  const eventType = typeof event.type === 'string' ? event.type
    : typeof parsed.type === 'string' ? parsed.type : 'event'
  const eventId = typeof parsed.event_id === 'string'
    ? parsed.event_id
    : createHash('sha256').update(body).digest('hex').slice(0, 24)

  const result = await fanoutRoutineEvent(orgId, {
    eventId,
    source: 'slack',
    summary: `Slack ${eventType}`,
    filter: { type: eventType },
    data: parsed,
  })

  return apiSuccess({ ok: true, ...result })
}
