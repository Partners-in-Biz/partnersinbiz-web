/**
 * GET /api/v1/reports/outstanding — outstanding invoices aged by dueDate.
 *
 * Query params:
 *   orgId (required)
 *
 * Returns aged buckets (0-30, 31-60, 61-90, 90+) of unpaid invoices where
 * status is sent, overdue, or payment_pending_verification. Ageing is
 * measured as (now - dueDate) in days; invoices with no dueDate are placed
 * in the 0-30 bucket (treated as not yet overdue).
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const OUTSTANDING_STATUSES = ['sent', 'overdue', 'payment_pending_verification']

type Bucket = { count: number; total: number }

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

  const buckets: Record<string, Bucket> = {
    '0-30': { count: 0, total: 0 },
    '31-60': { count: 0, total: 0 },
    '61-90': { count: 0, total: 0 },
    '90+': { count: 0, total: 0 },
  }
  let total = 0
  let count = 0
  let currencySeen: string | null = null
  let mixed = false

  try {
    // Firestore 'in' supports up to 30 values — safe with 3 statuses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await adminDb
      .collection('invoices')
      .where('orgId', '==', orgId)
      .where('status', 'in', OUTSTANDING_STATUSES)
      .get()

    if (snapshot.empty) {
      return apiSuccess({ buckets, total: 0, count: 0, currency: null })
    }

    const now = Date.now()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data() ?? {}
      const due = toDateSafe(data.dueDate)
      const amount = Number(data.total ?? 0)
      const currency = (data.currency as string | undefined) ?? 'USD'

      if (currencySeen === null) currencySeen = currency
      else if (currencySeen !== currency) mixed = true

      let key: keyof typeof buckets = '0-30'
      if (due) {
        const ageDays = Math.floor((now - due.getTime()) / 86_400_000)
        if (ageDays <= 30) key = '0-30'
        else if (ageDays <= 60) key = '31-60'
        else if (ageDays <= 90) key = '61-90'
        else key = '90+'
      }

      buckets[key].count += 1
      buckets[key].total += amount
      total += amount
      count += 1
    })

    return apiSuccess({
      buckets,
      total,
      count,
      ...(mixed ? { mixed: true } : { currency: currencySeen ?? null }),
    })
  } catch (err) {
    console.error('[reports/outstanding] error:', err)
    return apiError('Failed to build outstanding report', 500)
  }
})
