/**
 * GET /api/v1/email-analytics/campaigns/[id]
 * Auth: client. Returns CampaignDetailedStats (includes contact-activity rows).
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCampaignStats } from '@/lib/email-analytics/aggregate'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { id } = await (context as Params).params
    const snap = await adminDb.collection('campaigns').doc(id).get()
    if (!snap.exists || snap.data()?.deleted === true) {
      return apiError('Campaign not found', 404)
    }
    const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
    if (!scope.ok) return apiError(scope.error, scope.status)

    try {
      const stats = await getCampaignStats(scope.orgId, id)
      return apiSuccess(stats)
    } catch (err) {
      return apiError((err as Error).message || 'Campaign not found', 404)
    }
  },
)
