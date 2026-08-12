/**
 * POST /api/v1/campaigns/[id]/launch — set status=active, resolve audience,
 *      enroll matching contacts in the campaign's sequence.
 *
 * Auth: admin/client (scoped to the campaign's org)
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import type { Campaign } from '@/lib/campaigns/types'
import type { ApiUser } from '@/lib/api/types'
import { launchCampaign } from '@/lib/campaigns/launch'
import { logActivity } from '@/lib/activity/log'
import { assertEmailMarketingAgentActionWithTask, assertEmailMarketingDispatchApproval } from '@/lib/email-marketing/agent-governance'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  const campaign = { id: snap.id, ...snap.data() } as Campaign

  const access = await assertMarketingHandlerAccess({
    user,
    module: 'campaigns',
    resourceId: id,
    resourceOwnerOrgId: campaign.orgId ?? null,
    operation: 'launch',
    partnerLinkId: extractPartnerLinkId(req),
  })
  if (!access.ok) return apiError(access.error, access.status)

  const approvalState = (campaign as Campaign & {
    approvalState?: {
      status?: string | null
      approvedBy?: string | null
      approvedByType?: string | null
      approvalTaskId?: string | null
    }
  }).approvalState
  try {
    await assertEmailMarketingAgentActionWithTask(user, 'email_marketing_send', approvalState, {
      orgId: access.orgId, resourceType: 'email_campaign', resourceId: id,
    }, campaign as unknown as Record<string, unknown>)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Email launch is not authorised', 403)
  }
  try {
    await assertEmailMarketingDispatchApproval(campaign as unknown as Record<string, unknown>, {
      orgId: access.orgId, resourceType: 'email_campaign', resourceId: id,
    })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Campaign approval is required by organisation policy', 403)
  }

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
