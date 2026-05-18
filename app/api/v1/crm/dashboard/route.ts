/**
 * GET /api/v1/crm/dashboard
 * Returns aggregated CRM metrics for the org.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Deal } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

export const GET = withCrmAuth('member', async (_req, ctx) => {
  const { orgId } = ctx

  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Fetch all non-deleted deals and recent activities in parallel
    const [dealsSnap, activitiesSnap] = await Promise.all([
      adminDb
        .collection('deals')
        .where('orgId', '==', orgId)
        .where('deleted', '!=', true)
        .limit(1000)
        .get(),
      adminDb
        .collection('activities')
        .where('orgId', '==', orgId)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get(),
    ])

    const deals = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Deal[]

    // Classify deals using probability heuristic:
    //   - probability === 100 → won
    //   - lostReason present  → lost
    //   - else                → open
    const open = deals.filter((d) => !d.lostReason && (d.probability ?? 50) < 100)

    const wonThisMonth = deals.filter((d) => {
      const updatedAt = (d.updatedAt as unknown as { toDate?: () => Date } | null)?.toDate?.() ?? null
      return d.probability === 100 && updatedAt !== null && updatedAt >= monthStart
    })

    const lostThisMonth = deals.filter((d) => {
      const updatedAt = (d.updatedAt as unknown as { toDate?: () => Date } | null)?.toDate?.() ?? null
      return !!d.lostReason && updatedAt !== null && updatedAt >= monthStart
    })

    const openDealsCount = open.length
    const openDealsValue = open.reduce((s, d) => s + (d.value ?? 0), 0)
    const weightedPipelineValue = open.reduce(
      (s, d) => s + (d.value ?? 0) * ((d.probability ?? 50) / 100),
      0,
    )
    const topOpenDeals = [...open]
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 5)

    const recentActivities = activitiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

    return apiSuccess({
      openDealsCount,
      openDealsValue,
      weightedPipelineValue,
      wonThisMonth: {
        count: wonThisMonth.length,
        value: wonThisMonth.reduce((s, d) => s + (d.value ?? 0), 0),
      },
      lostThisMonth: {
        count: lostThisMonth.length,
      },
      recentActivities,
      topOpenDeals,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
