/**
 * POST /api/v1/integrations/github/webhook?orgId=…
 * Verify X-Hub-Signature-256 and fan out to github event routines.
 */
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { fanoutRoutineEvent } from '@/lib/routines/event-fanout'
import { resolveIntegrationSecret, verifyGitHubSignature } from '@/lib/routines/integrations'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('orgId')?.trim()
  if (!orgId) return apiError('orgId query required', 400)
  if (!(await orgFeatureFlagEnabled(orgId, 'botRoutinesEnabled'))) {
    return apiError('feature_disabled', 404)
  }

  const secret = await resolveIntegrationSecret(orgId, 'github')
  if (!secret) return apiError('GitHub integration not configured', 404)

  const body = await req.text()
  if (!verifyGitHubSignature(secret, body, req.headers.get('x-hub-signature-256'))) {
    return apiError('Unauthorized', 401)
  }

  let parsed: Record<string, unknown> = {}
  try {
    parsed = body ? JSON.parse(body) as Record<string, unknown> : {}
  } catch {
    parsed = {}
  }

  const delivery = req.headers.get('x-github-delivery')?.trim()
  const eventName = req.headers.get('x-github-event')?.trim() || 'unknown'
  const eventId = delivery || createHash('sha256').update(body).digest('hex').slice(0, 24)

  const result = await fanoutRoutineEvent(orgId, {
    eventId,
    source: 'github',
    summary: `GitHub ${eventName}`,
    filter: { event: eventName },
    data: parsed,
  })

  return apiSuccess({ ok: true, ...result })
}
