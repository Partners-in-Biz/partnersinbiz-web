/**
 * POST   /api/v1/campaigns/[id]/schedule-email — schedule an email campaign send
 * DELETE /api/v1/campaigns/[id]/schedule-email — cancel a scheduled send (back to draft)
 *
 * POST body: { scheduledAt: string (ISO), timezone?: string }
 *   Stores scheduledAt + startAt, sets status='scheduled'. The
 *   /api/v1/campaigns/run-scheduled processor enrols the audience when the
 *   scheduled time arrives.
 *
 * This is distinct from /[id]/schedule which bulk-schedules social posts on a
 * content-engine campaign.
 *
 * Auth: client (scoped to the campaign's org)
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const scheduledAtRaw = typeof body.scheduledAt === 'string' ? body.scheduledAt : ''
  if (!scheduledAtRaw) return apiError('scheduledAt (ISO timestamp) is required', 400)
  const scheduledDate = new Date(scheduledAtRaw)
  if (isNaN(scheduledDate.getTime())) return apiError('Invalid scheduledAt', 400)
  if (scheduledDate.getTime() <= Date.now()) {
    return apiError('scheduledAt must be in the future', 400)
  }

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = snap.data() as any
  const scope = resolveOrgScope(user, (campaign.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  if (campaign.status === 'active' || campaign.status === 'completed') {
    return apiError(`Cannot schedule a campaign with status=${campaign.status}`, 422)
  }
  if (!campaign.sequenceId) {
    return apiError('Campaign has no sequence — add content before scheduling', 422)
  }
  const hasAudience =
    !!campaign.segmentId ||
    !!campaign.tagId ||
    (Array.isArray(campaign.contactIds) && campaign.contactIds.length > 0)
  if (!hasAudience) {
    return apiError('Campaign has no audience — set a segment, tag, or contacts first', 422)
  }

  const ts = Timestamp.fromDate(scheduledDate)
  await snap.ref.update({
    status: 'scheduled',
    scheduledAt: ts,
    startAt: ts,
    scheduleTimezone: typeof body.timezone === 'string' ? body.timezone : 'Africa/Johannesburg',
    updatedAt: FieldValue.serverTimestamp(),
  })

  logActivity({
    orgId: campaign.orgId,
    type: 'campaign_scheduled',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Scheduled email campaign for ${scheduledDate.toISOString()}`,
    entityId: id,
    entityType: 'campaign',
    entityTitle: campaign.name ?? undefined,
  }).catch(() => {})

  return apiSuccess({ id, status: 'scheduled', scheduledAt: scheduledDate.toISOString() })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = snap.data() as any
  const scope = resolveOrgScope(user, (campaign.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  if (campaign.status !== 'scheduled') {
    return apiError('Campaign is not scheduled', 422)
  }

  await snap.ref.update({
    status: 'draft',
    scheduledAt: null,
    startAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  })

  logActivity({
    orgId: campaign.orgId,
    type: 'campaign_updated',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Cancelled scheduled send',
    entityId: id,
    entityType: 'campaign',
    entityTitle: campaign.name ?? undefined,
  }).catch(() => {})

  return apiSuccess({ id, status: 'draft' })
})
