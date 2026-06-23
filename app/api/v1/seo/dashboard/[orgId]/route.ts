import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildSeoDashboard } from '@/lib/seo/dashboard'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/seo/dashboard/[orgId]?sprintId=...
 *
 * Aggregated SEO dashboard for an org. If `sprintId` is omitted, the most
 * recently advanced sprint for the org is used.
 */
export const GET = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ orgId: string }> }) => {
    const { orgId } = await ctx.params
    if (!canAccessOrg(user, orgId)) return apiError('Access denied', 403)

    const requestedSprintId = new URL(req.url).searchParams.get('sprintId')

    const sprintsSnap = await adminDb
      .collection('seo_sprints')
      .where('orgId', '==', orgId)
      .where('deleted', '==', false)
      .get()

    const sprints = sprintsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { siteUrl?: string; currentDay?: number }) }))
      .sort((a, b) => Number(b.currentDay ?? 0) - Number(a.currentDay ?? 0))

    const active = (requestedSprintId && sprints.find((s) => s.id === requestedSprintId)) || sprints[0] || null

    const dashboard = await buildSeoDashboard(orgId, active?.id ?? null, active?.siteUrl ?? '')
    return apiSuccess({
      ...dashboard,
      sprints: sprints.map((s) => ({ id: s.id, siteUrl: s.siteUrl ?? '' })),
    })
  },
)
