/**
 * GET /api/v1/reports/revenue — revenue grouped by time bucket.
 *
 * Query params:
 *   orgId    (required) — billing org scope
 *   from     (required, ISO) — inclusive start of window, compared against paidAt
 *   to       (required, ISO) — inclusive end of window, compared against paidAt
 *   groupBy  — "month" (default) | "quarter" | "week" | "day"
 *
 * Returns aggregate buckets of paid invoices keyed by paidAt. If all invoices
 * share a single currency the response reports that currency top-level; mixed
 * currencies fall back to per-bucket `byCurrency` maps with `mixed: true`.
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'

export const dynamic = 'force-dynamic'

type GroupBy = 'month' | 'quarter' | 'week' | 'day'
const VALID_GROUP_BY: GroupBy[] = ['month', 'quarter', 'week', 'day']

function bucketLabel(d: Date, groupBy: GroupBy): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  if (groupBy === 'day') {
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  if (groupBy === 'week') {
    // ISO week start (Monday) label: YYYY-Www
    const tmp = new Date(Date.UTC(y, d.getUTCMonth(), day))
    const dayNum = tmp.getUTCDay() || 7
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
  }
  if (groupBy === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1
    return `${y}-Q${q}`
  }
  // month (default)
  return `${y}-${String(m).padStart(2, '0')}`
}

function toDateSafe(v: unknown): Date | null {
  if (!v) return null
  // Firestore Timestamp has toDate(); plain strings/Dates also accepted
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

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  const groupByRaw = (searchParams.get('groupBy') ?? 'month') as GroupBy

  if (!fromStr) return apiError('from is required (ISO date)', 400)
  if (!toStr) return apiError('to is required (ISO date)', 400)
  if (!VALID_GROUP_BY.includes(groupByRaw)) {
    return apiError('Invalid groupBy; expected month | quarter | week | day', 400)
  }

  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return apiError('from/to must be valid ISO dates', 400)
  }

  const groupBy = groupByRaw

  try {
    // Simple single-field range on paidAt; we filter orgId/status in memory so
    // the Firestore composite index stays minimal (orgId, status, paidAt desc).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = adminDb
      .collection('invoices')
      .where('orgId', '==', orgId)
      .where('status', '==', 'paid')

    const snapshot = await query.get()

    if (snapshot.empty) {
      return apiSuccess({
        from: from.toISOString(),
        to: to.toISOString(),
        groupBy,
        buckets: [],
        grandTotal: 0,
        currency: null,
      })
    }

    const bucketMap = new Map<
      string,
      { total: number; count: number; byCurrency: Record<string, number> }
    >()
    let grandTotal = 0
    let currencySeen: string | null = null
    let mixed = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data() ?? {}
      const paidAt = toDateSafe(data.paidAt)
      if (!paidAt) return
      if (paidAt < from || paidAt > to) return

      const label = bucketLabel(paidAt, groupBy)
      const total = Number(data.total ?? 0)
      const currency = (data.currency as string | undefined) ?? 'USD'

      if (currencySeen === null) currencySeen = currency
      else if (currencySeen !== currency) mixed = true

      const existing = bucketMap.get(label) ?? {
        total: 0,
        count: 0,
        byCurrency: {} as Record<string, number>,
      }
      existing.total += total
      existing.count += 1
      existing.byCurrency[currency] = (existing.byCurrency[currency] ?? 0) + total
      bucketMap.set(label, existing)
      grandTotal += total
    })

    const buckets = Array.from(bucketMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([label, v]) =>
        mixed
          ? { label, total: v.total, count: v.count, byCurrency: v.byCurrency }
          : { label, total: v.total, count: v.count },
      )

    return apiSuccess({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      buckets,
      grandTotal,
      ...(mixed ? { mixed: true } : { currency: currencySeen ?? null }),
    })
  } catch (err) {
    console.error('[reports/revenue] error:', err)
    return apiError('Failed to build revenue report', 500)
  }
})
