/**
 * POST /api/v1/broadcasts/[id]/schedule
 *
 * Body: { scheduledFor: ISO 8601 string }
 *
 * Validates content + audience + from address, then flips status
 * draft|paused → scheduled and saves scheduledFor. The cron picks it up
 * once scheduledFor <= now.
 *
 * Returns 422 with { issues: string[] } if validation fails.
 *
 * Auth: client.
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { validateBroadcastForSend } from '@/lib/broadcasts/validate'
import { runPreflight } from '@/lib/email/preflight'
import { preflightInputForBroadcast } from '@/lib/email/preflight-source'
import type { Broadcast } from '@/lib/broadcasts/types'
import type { ApiUser } from '@/lib/api/types'
import { assertEmailMarketingAgentAction } from '@/lib/email-marketing/agent-governance'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const scheduledForRaw = typeof body.scheduledFor === 'string' ? body.scheduledFor : ''
  if (!scheduledForRaw) return apiError('scheduledFor is required (ISO 8601 string)', 400)
  const scheduledDate = new Date(scheduledForRaw)
  if (Number.isNaN(scheduledDate.getTime())) return apiError('scheduledFor is not a valid date', 400)
  if (scheduledDate.getTime() <= Date.now()) {
    return apiError('scheduledFor must be in the future', 400)
  }

  const ref = adminDb.collection('broadcasts').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const broadcast = { id: snap.id, ...snap.data() } as Broadcast
  const scope = resolveOrgScope(user, broadcast.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  try {
    assertEmailMarketingAgentAction(
      user,
      'email_marketing_send',
      (broadcast as Broadcast & { approvalState?: Record<string, string | null> }).approvalState,
    )
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Broadcast scheduling is not authorised', 403)
  }

  if (!['draft', 'paused', 'scheduled'].includes(broadcast.status)) {
    return apiError(`Cannot schedule a broadcast with status=${broadcast.status}`, 422)
  }

  const validation = await validateBroadcastForSend(broadcast)
  if (!validation.ok) {
    return apiError('Validation failed', 422, { issues: validation.issues })
  }

  // Preflight quality gate. `force: true` in the body skips errors but logs
  // them on the broadcast for audit purposes. Warnings never block.
  const force = body.force === true
  const preflightInput = await preflightInputForBroadcast(broadcast)
  const preflight = await runPreflight(preflightInput)
  if (!preflight.pass && !force) {
    return apiError('Preflight failed', 422, {
      error: 'Preflight failed',
      issues: preflight.issues,
      report: preflight,
    })
  }
  if (!preflight.pass && force) {
    // Audit the override — never silent.
    console.warn(
      '[broadcast/schedule] force=true bypass with',
      preflight.errorCount,
      'errors on broadcast',
      id,
    )
  }

  await ref.update({
    status: 'scheduled',
    scheduledFor: Timestamp.fromDate(scheduledDate),
    'stats.audienceSize': validation.audienceSize,
    lastPreflight: {
      pass: preflight.pass,
      errorCount: preflight.errorCount,
      warningCount: preflight.warningCount,
      forced: !preflight.pass && force,
      scannedAt: preflight.scannedAt,
    },
    ...lastActorFrom(user),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({
    id,
    status: 'scheduled',
    scheduledFor: scheduledDate.toISOString(),
    audienceSize: validation.audienceSize,
    preflight: { pass: preflight.pass, warningCount: preflight.warningCount },
  })
})
