/**
 * GET /api/v1/reports/expense-summary — expenses grouped by category/project/user.
 *
 * Query params:
 *   orgId   (required)
 *   from    (ISO, optional; defaults to 30 days ago)
 *   to      (ISO, optional; defaults to now)
 *   groupBy — "category" (default) | "project" | "user"
 *
 * Aggregates `expenses` where `orgId==X AND date BETWEEN from AND to AND
 * deleted!=true`. The `expenses` collection is owned by A8 — handled
 * gracefully when missing (returns empty buckets + zero totals).
 *
 * Response shape: `{ from, to, groupBy, buckets: [{label,total,count,billable,reimbursable}], grandTotal, currency }`.
 * `billable` and `reimbursable` are counts of matching entries in the bucket.
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type GroupBy = 'category' | 'project' | 'user'
const VALID_GROUP_BY: GroupBy[] = ['category', 'project', 'user']

type Bucket = {
  label: string
  total: number
  count: number
  billable: number
  reimbursable: number
}

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

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as a query param', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const groupByRaw = (searchParams.get('groupBy') ?? 'category') as GroupBy
  if (!VALID_GROUP_BY.includes(groupByRaw)) {
    return apiError('Invalid groupBy; expected category | project | user', 400)
  }
  const groupBy: GroupBy = groupByRaw

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
      .collection('expenses')
      .where('orgId', '==', orgId)
      .get()

    if (!snapshot || snapshot.empty) {
      return apiSuccess({
        from: from.toISOString(),
        to: to.toISOString(),
        groupBy,
        buckets: [],
        grandTotal: 0,
        currency: null,
      })
    }

    const bucketMap = new Map<string, Bucket>()
    let grandTotal = 0
    let currencySeen: string | null = null
    let mixed = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data() ?? {}
      if (data.deleted === true) return
      const date = toDateSafe(data.date)
      if (!date) return
      if (date < from || date > to) return

      const amount = Number(data.amount ?? 0)
      const currency = (data.currency as string | undefined) ?? 'USD'
      if (currencySeen === null) currencySeen = currency
      else if (currencySeen !== currency) mixed = true

      let label = 'uncategorised'
      if (groupBy === 'category') label = (data.category as string) || 'uncategorised'
      else if (groupBy === 'project') label = (data.projectId as string) || 'no-project'
      else if (groupBy === 'user') label = (data.userId as string) || 'unknown'

      const bucket = bucketMap.get(label) ?? {
        label,
        total: 0,
        count: 0,
        billable: 0,
        reimbursable: 0,
      }
      bucket.total += amount
      bucket.count += 1
      if (data.billable) bucket.billable += 1
      if (data.reimbursable) bucket.reimbursable += 1
      bucketMap.set(label, bucket)
      grandTotal += amount
    })

    const buckets = Array.from(bucketMap.values()).sort((a, b) => b.total - a.total)

    return apiSuccess({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      buckets,
      grandTotal,
      ...(mixed ? { mixed: true } : { currency: currencySeen ?? null }),
    })
  } catch (err) {
    // expenses collection may not exist yet (A8 owns it) — return empty.
    console.warn('[reports/expense-summary] query failed, returning empty:', err)
    return apiSuccess({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      buckets: [],
      grandTotal: 0,
      currency: null,
    })
  }
})
