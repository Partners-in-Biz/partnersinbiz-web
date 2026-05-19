/**
 * GET /api/v1/crm/reports/forecast
 * Returns open deal pipeline bucketed by expected close date.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Deal } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

interface PeriodBucket {
  dealCount: number
  totalValue: number
  weightedValue: number
}

type PeriodKey = 'thisMonth' | 'nextMonth' | 'thisQuarter' | 'nextQuarter' | 'beyond' | 'noDate'

function emptyBucket(): PeriodBucket {
  return { dealCount: 0, totalValue: 0, weightedValue: 0 }
}

function quarterOf(month: number): number {
  // month is 0-indexed (0 = Jan)
  return Math.floor(month / 3)
}

function getExpectedCloseDate(deal: Deal): Date | null {
  const raw = deal.expectedCloseDate
  if (!raw) return null
  // Firestore Timestamp
  if (raw && typeof (raw as unknown as { toDate?: unknown }).toDate === 'function') {
    return (raw as unknown as { toDate: () => Date }).toDate()
  }
  // ISO string or any other value
  const d = new Date(raw as unknown as string)
  return isNaN(d.getTime()) ? null : d
}

function classifyPeriod(closeDate: Date | null, now: Date): PeriodKey {
  if (!closeDate) return 'noDate'

  const cy = now.getFullYear()
  const cm = now.getMonth() // 0-indexed

  const dy = closeDate.getFullYear()
  const dm = closeDate.getMonth() // 0-indexed

  const cq = quarterOf(cm)

  // thisMonth
  if (dy === cy && dm === cm) return 'thisMonth'

  // nextMonth
  const nextMonthDate = new Date(cy, cm + 1, 1)
  const ny = nextMonthDate.getFullYear()
  const nm = nextMonthDate.getMonth()
  if (dy === ny && dm === nm) return 'nextMonth'

  // thisQuarter (but not thisMonth or nextMonth)
  if (dy === cy && quarterOf(dm) === cq) return 'thisQuarter'

  // nextQuarter
  const nextQuarterStart = cq < 3 ? cq + 1 : 0
  const nextQuarterYear = cq < 3 ? cy : cy + 1
  if (dy === nextQuarterYear && quarterOf(dm) === nextQuarterStart) return 'nextQuarter'

  // beyond
  return 'beyond'
}

export const GET = withCrmAuth('member', async (_req, ctx) => {
  const { orgId } = ctx

  try {
    const snap = await adminDb
      .collection('deals')
      .where('orgId', '==', orgId)
      .limit(2000)
      .get()

    const deals = snap.docs
      .map((d) => ({ id: d.id, ...d.data() })) as Deal[]

    // Classify open deals — same heuristic as dashboard
    const open = deals.filter((d) => d.deleted !== true && !d.lostReason && (d.probability ?? 50) < 100)

    const now = new Date()

    const periods: Record<PeriodKey, PeriodBucket> = {
      thisMonth: emptyBucket(),
      nextMonth: emptyBucket(),
      thisQuarter: emptyBucket(),
      nextQuarter: emptyBucket(),
      beyond: emptyBucket(),
      noDate: emptyBucket(),
    }

    let totalValue = 0
    let totalWeighted = 0

    for (const deal of open) {
      const closeDate = getExpectedCloseDate(deal)
      const key = classifyPeriod(closeDate, now)
      const value = deal.value ?? 0
      const weighted = value * ((deal.probability ?? 50) / 100)

      periods[key].dealCount++
      periods[key].totalValue += value
      periods[key].weightedValue += weighted

      totalValue += value
      totalWeighted += weighted
    }

    return apiSuccess({
      periods,
      summary: {
        totalOpenDeals: open.length,
        totalValue,
        weightedValue: totalWeighted,
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
