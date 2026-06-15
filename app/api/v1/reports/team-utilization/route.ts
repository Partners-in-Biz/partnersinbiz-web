/**
 * GET /api/v1/reports/team-utilization — billable vs non-billable per user.
 *
 * Query params:
 *   orgId (required)
 *   from  (ISO, optional; defaults to 30 days ago)
 *   to    (ISO, optional; defaults to now)
 *
 * Aggregates `time_entries` where `orgId==X AND startAt BETWEEN from AND to`,
 * grouped by `userId`, splitting billable vs non-billable minutes. The
 * `time_entries` collection is owned by the A7 time-tracking module; if the
 * collection is empty (or the index doesn't exist yet) this endpoint returns
 * zeroed totals rather than erroring.
 *
 * Utilisation % is computed as billable / total minutes per user (0-100).
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'

export const dynamic = 'force-dynamic'

function toDateSafe(v: unknown): Date | null {
  if (!v) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyV = v as any
  if (typeof anyV?.toDate === 'function') return anyV.toDate()
  if (anyV instanceof Date) return anyV
  if (typeof anyV === 'string' || typeof anyV === 'number') {
    const d = new Date(anyV)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof anyV?._seconds === 'number') return new Date(anyV._seconds * 1000)
  return null
}

type UserAgg = {
  userId: string
  totalMinutes: number
  billableMinutes: number
  nonBillableMinutes: number
  utilizationPct: number
}

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  const from = fromStr ? new Date(fromStr) : defaultFrom
  const to = toStr ? new Date(toStr) : now
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return apiError('from/to must be valid ISO dates', 400)
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await adminDb
      .collection('time_entries')
      .where('orgId', '==', orgId)
      .get()

    if (!snapshot || snapshot.empty) {
      return apiSuccess({
        users: [],
        totalMinutes: 0,
        avgUtilizationPct: 0,
      })
    }

    const byUser = new Map<string, UserAgg>()
    let grandTotal = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data() ?? {}
      if (data.deleted === true) return
      const startAt = toDateSafe(data.startAt)
      if (!startAt) return
      if (startAt < from || startAt > to) return

      const userId = (data.userId as string) ?? 'unknown'
      const duration = Number(data.durationMinutes ?? 0)
      const billable = Boolean(data.billable)

      const agg = byUser.get(userId) ?? {
        userId,
        totalMinutes: 0,
        billableMinutes: 0,
        nonBillableMinutes: 0,
        utilizationPct: 0,
      }
      agg.totalMinutes += duration
      if (billable) agg.billableMinutes += duration
      else agg.nonBillableMinutes += duration
      byUser.set(userId, agg)
      grandTotal += duration
    })

    const users = Array.from(byUser.values()).map((u) => ({
      ...u,
      utilizationPct:
        u.totalMinutes > 0
          ? Math.round((u.billableMinutes / u.totalMinutes) * 10000) / 100
          : 0,
    }))

    const avgUtilizationPct =
      users.length > 0
        ? Math.round(
            (users.reduce((s, u) => s + u.utilizationPct, 0) / users.length) * 100,
          ) / 100
        : 0

    return apiSuccess({
      users: users.sort((a, b) => b.totalMinutes - a.totalMinutes),
      totalMinutes: grandTotal,
      avgUtilizationPct,
    })
  } catch (err) {
    // time_entries collection may not exist yet (A7 owns it) — return zeros.
    console.warn('[reports/team-utilization] query failed, returning zeros:', err)
    return apiSuccess({
      users: [],
      totalMinutes: 0,
      avgUtilizationPct: 0,
    })
  }
})
