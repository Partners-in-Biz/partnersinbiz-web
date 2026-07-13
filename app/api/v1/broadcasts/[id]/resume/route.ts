/**
 * POST /api/v1/broadcasts/[id]/resume
 *
 * Transitions paused → scheduled (uses existing scheduledFor; if that's now
 * in the past the next cron tick will pick it up immediately).
 * Auth: client.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { Broadcast } from '@/lib/broadcasts/types'
import type { ApiUser } from '@/lib/api/types'
import { assertEmailMarketingAgentActionWithTask, assertEmailMarketingDispatchApproval } from '@/lib/email-marketing/agent-governance'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const ref = adminDb.collection('broadcasts').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const current = { id: snap.id, ...snap.data() } as Broadcast
  const scope = resolveOrgScope(user, current.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  if (current.status === 'scheduled') return apiSuccess({ id, status: 'scheduled' })
  if (current.status !== 'paused') {
    return apiError(`Cannot resume a broadcast with status=${current.status}`, 422)
  }

  try {
    await assertEmailMarketingAgentActionWithTask(
      user, 'email_marketing_send', current.approvalState,
      { orgId: scope.orgId, resourceType: 'email_broadcast', resourceId: id },
      current as unknown as Record<string, unknown>,
    )
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Broadcast resume is not authorised', 403)
  }
  try {
    await assertEmailMarketingDispatchApproval(current as unknown as Record<string, unknown>, {
      orgId: scope.orgId, resourceType: 'email_broadcast', resourceId: id,
    })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Broadcast approval is required by organisation policy', 403)
  }

  await ref.update({
    status: 'scheduled',
    ...lastActorFrom(user),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id, status: 'scheduled' })
})
