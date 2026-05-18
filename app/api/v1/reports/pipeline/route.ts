/**
 * GET /api/v1/reports/pipeline — deal pipeline snapshot.
 *
 * Query params:
 *   orgId (required)
 *
 * Groups non-deleted deals by stage, returning per-stage count + summed value,
 * plus aggregate open / closed-won / closed-lost totals and a win rate.
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type StageBucket = { count: number; value: number }

const CLOSED_WON = new Set(['won'])
const CLOSED_LOST = new Set(['lost'])

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as a query param', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await adminDb
      .collection('deals')
      .where('orgId', '==', orgId)
      .get()

    const byStage: Record<string, StageBucket> = {}
    let totalOpen = 0
    let totalClosedWon = 0
    let totalClosedLost = 0
    let closedWonCount = 0
    let closedLostCount = 0

    if (!snapshot.empty) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshot.docs.forEach((doc: any) => {
        const data = doc.data() ?? {}
        if (data.deleted === true) return

        const stage = (data.stage as string) ?? 'unknown'
        const value = Number(data.value ?? 0)

        const bucket = byStage[stage] ?? { count: 0, value: 0 }
        bucket.count += 1
        bucket.value += value
        byStage[stage] = bucket

        if (CLOSED_WON.has(stage)) {
          totalClosedWon += value
          closedWonCount += 1
        } else if (CLOSED_LOST.has(stage)) {
          totalClosedLost += value
          closedLostCount += 1
        } else {
          totalOpen += value
        }
      })
    }

    const closedCount = closedWonCount + closedLostCount
    const winRate = closedCount > 0 ? closedWonCount / closedCount : 0

    return apiSuccess({
      byStage,
      totalOpen,
      totalClosedWon,
      totalClosedLost,
      winRate: Math.round(winRate * 10000) / 10000,
    })
  } catch (err) {
    console.error('[reports/pipeline] error:', err)
    return apiError('Failed to build pipeline report', 500)
  }
})
