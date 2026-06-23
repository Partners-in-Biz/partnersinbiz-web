/**
 * POST /api/v1/campaigns/[id]/launch — set status=active, resolve audience,
 *      enroll matching contacts in the campaign's sequence.
 *
 * Auth: admin/client (scoped to the campaign's org)
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Campaign } from '@/lib/campaigns/types'
import type { ApiUser } from '@/lib/api/types'
import { launchCampaign } from '@/lib/campaigns/launch'
import { logActivity } from '@/lib/activity/log'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  const campaign = { id: snap.id, ...snap.data() } as Campaign

  const scope = resolveOrgScope(user, campaign.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const result = await launchCampaign(campaign, snap.ref)
  if (!result.ok) return apiError(result.error ?? 'Launch failed', result.status)

  logActivity({
    orgId: campaign.orgId,
    type: 'campaign_launched',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Launched campaign',
    entityId: campaign.id,
    entityType: 'campaign',
    entityTitle: campaign.name ?? undefined,
  }).catch(() => {})

  return apiSuccess({ enrolled: result.enrolled, audienceSize: result.audienceSize })
})
