/**
 * POST /api/v1/broadcasts/[id]/send-now
 *
 * Two modes:
 *   • Default (no body or `{ immediate: false }`):  flips status → scheduled
 *     with scheduledFor = now so the next cron tick processes it.
 *   • `{ immediate: true }`:  synchronously sends inline. Hard-capped at 100
 *     recipients — anything larger must use scheduled send to avoid blowing
 *     the Vercel function timeout.
 *
 * Validation identical to /schedule.
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
import { resolveBroadcastAudience } from '@/lib/broadcasts/audience'
import {
  buildSendContext,
  loadSentContactIds,
  sendBroadcastToContact,
} from '@/lib/broadcasts/send'
import type { Broadcast } from '@/lib/broadcasts/types'
import type { ApiUser } from '@/lib/api/types'
import { assertEmailMarketingAgentActionWithTask, assertEmailMarketingDispatchApproval } from '@/lib/email-marketing/agent-governance'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SYNC_LIMIT = 100

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = (await req.json().catch(() => ({}))) ?? {}
  const immediate = body.immediate === true

  const ref = adminDb.collection('broadcasts').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const broadcast = { id: snap.id, ...snap.data() } as Broadcast
  const scope = resolveOrgScope(user, broadcast.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  try {
    await assertEmailMarketingAgentActionWithTask(
      user,
      'email_marketing_send',
      (broadcast as Broadcast & { approvalState?: Record<string, string | null> }).approvalState,
      { orgId: scope.orgId, resourceType: 'email_broadcast', resourceId: id },
      broadcast as unknown as Record<string, unknown>,
    )
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Broadcast sending is not authorised', 403)
  }
  try {
    await assertEmailMarketingDispatchApproval(broadcast as unknown as Record<string, unknown>, {
      orgId: scope.orgId, resourceType: 'email_broadcast', resourceId: id,
    })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Broadcast approval is required by organisation policy', 403)
  }

  if (!['draft', 'paused', 'scheduled'].includes(broadcast.status)) {
    return apiError(`Cannot send a broadcast with status=${broadcast.status}`, 422)
  }

  const validation = await validateBroadcastForSend(broadcast)
  if (!validation.ok) {
    return apiError('Validation failed', 422, { issues: validation.issues })
  }

  // Preflight quality gate. Same `force: true` escape hatch as /schedule.
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
    console.warn(
      '[broadcast/send-now] force=true bypass with',
      preflight.errorCount,
      'errors on broadcast',
      id,
    )
  }

  const preflightAudit = {
    pass: preflight.pass,
    errorCount: preflight.errorCount,
    warningCount: preflight.warningCount,
    forced: !preflight.pass && force,
    scannedAt: preflight.scannedAt,
  }

  // Path A: schedule for "now" and let the cron pick it up.
  if (!immediate) {
    await ref.update({
      status: 'scheduled',
      scheduledFor: Timestamp.now(),
      'stats.audienceSize': validation.audienceSize,
      lastPreflight: preflightAudit,
      ...lastActorFrom(user),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({
      id,
      status: 'scheduled',
      mode: 'queued',
      audienceSize: validation.audienceSize,
    })
  }

  // Path B: synchronous inline send.
  if (validation.audienceSize > SYNC_LIMIT) {
    return apiError(
      `Audience size (${validation.audienceSize}) exceeds the synchronous send limit of ${SYNC_LIMIT}. Use scheduled send instead.`,
      422,
      { audienceSize: validation.audienceSize },
    )
  }

  await ref.update({
    status: 'sending',
    sendStartedAt: FieldValue.serverTimestamp(),
    'stats.audienceSize': validation.audienceSize,
    lastPreflight: preflightAudit,
    ...lastActorFrom(user),
    updatedAt: FieldValue.serverTimestamp(),
  })

  const refreshed = await ref.get()
  const live = { id: refreshed.id, ...refreshed.data() } as Broadcast

  const contacts = await resolveBroadcastAudience(live.orgId, live.audience)
  const sentCache = await loadSentContactIds(live.id)
  const ctx = await buildSendContext(live)

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const contact of contacts) {
    try {
      const outcome = await sendBroadcastToContact(ctx, contact, sentCache)
      if (outcome.status === 'sent') sent++
      else if (outcome.status === 'failed') failed++
      else skipped++
    } catch (err) {
      failed++
      // eslint-disable-next-line no-console
      console.error('[send-now] contact send failed', live.id, contact.id, err)
    }
  }

  await ref.update({
    status: 'sent',
    sendCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({
    id,
    status: 'sent',
    mode: 'immediate',
    audienceSize: contacts.length,
    sent,
    failed,
    skipped,
  })
})
