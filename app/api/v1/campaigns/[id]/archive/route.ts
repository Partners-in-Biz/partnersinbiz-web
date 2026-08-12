/**
 * POST /api/v1/campaigns/[id]/archive — archive a content-engine campaign.
 *
 * Default: sets `status: 'archived'`. If body.force === true, also sets
 * `deleted: true` for soft-delete.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { id } = await (context as Params).params
    const body = await req.json().catch(() => ({}))
    const ref = adminDb.collection('campaigns').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Campaign not found', 404)
    const data = snap.data()!
    if (data.deleted) return apiError('Campaign not found', 404)
    const access = await assertMarketingHandlerAccess({
      user,
      module: 'campaigns',
      resourceId: id,
      resourceOwnerOrgId: (data.orgId as string | undefined) ?? null,
      operation: 'archive',
      partnerLinkId: extractPartnerLinkId(req, body as Record<string, unknown>),
    })
    if (!access.ok) return apiError(access.error, access.status)

    const update: Record<string, unknown> = {
      status: 'archived',
      ...lastActorFrom(user),
    }
    if (body?.force === true) update.deleted = true

    await ref.update(update)

    logActivity({
      orgId: data.orgId,
      type: 'campaign_archived',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Archived campaign',
      entityId: id,
      entityType: 'campaign',
      entityTitle: data.name ?? undefined,
    }).catch(() => {})

    return apiSuccess({ id, status: 'archived', deleted: update.deleted === true })
  }),
)
