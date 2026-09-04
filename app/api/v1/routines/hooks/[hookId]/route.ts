/**
 * POST /api/v1/routines/hooks/[hookId] — generic HMAC webhook for event routines.
 * Headers: X-PIB-Signature, X-PIB-Timestamp (same scheme as lib/webhooks/sign.ts).
 */
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { verifyPibHookSignature } from '@/lib/routines/integrations'
import { fireRoutineForEvent, resolveRoutineHookSecret } from '@/lib/routines/service'
import { getRoutineByHookId } from '@/lib/routines/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ hookId: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { hookId } = await ctx.params
  if (!hookId?.trim()) return apiError('Missing hookId', 400)

  const routine = await getRoutineByHookId(hookId.trim())
  if (!routine || !routine.enabled || routine.status !== 'active') {
    return apiError('Not found', 404)
  }
  if (!(await orgFeatureFlagEnabled(routine.orgId, 'botRoutinesEnabled'))) {
    return apiError('feature_disabled', 404)
  }

  const secret = resolveRoutineHookSecret(routine)
  if (!secret) return apiError('Hook secret unavailable', 503)

  const body = await req.text()
  if (!verifyPibHookSignature({
    secret,
    body,
    timestampHeader: req.headers.get('x-pib-timestamp'),
    signatureHeader: req.headers.get('x-pib-signature'),
  })) {
    return apiError('Unauthorized', 401)
  }

  let parsed: Record<string, unknown> = {}
  try {
    parsed = body ? JSON.parse(body) as Record<string, unknown> : {}
  } catch {
    parsed = { raw: body }
  }

  const eventId = typeof parsed.eventId === 'string' && parsed.eventId.trim()
    ? parsed.eventId.trim()
    : createHash('sha256').update(body || hookId).digest('hex').slice(0, 24)

  const filter: Record<string, string> = {}
  if (parsed.filter && typeof parsed.filter === 'object' && !Array.isArray(parsed.filter)) {
    for (const [k, v] of Object.entries(parsed.filter as Record<string, unknown>)) {
      if (typeof v === 'string') filter[k] = v
    }
  }

  const run = await fireRoutineForEvent(routine, {
    eventId,
    source: 'webhook',
    summary: typeof parsed.summary === 'string' ? parsed.summary : `Webhook ${hookId}`,
    filter,
    data: parsed,
  })

  return apiSuccess({ accepted: true, runId: run?.runId ?? null, deduped: !run })
}
