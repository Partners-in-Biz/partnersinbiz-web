/**
 * GET /api/v1/reports/activity-summary — cross-system activity counts.
 *
 * Query params:
 *   orgId (required)
 *   from  (ISO, optional; defaults to 30 days ago)
 *   to    (ISO, optional; defaults to now)
 *
 * Aggregates counts of activity across collections inside the window:
 *   - social_posts: published (status=published, publishedAt in range)
 *   - email: sent (status=sent, sentAt in range)
 *   - invoices: created (createdAt in range)
 *   - deals: stage_changed (updatedAt in range)
 *   - contacts: created (createdAt in range)
 *   - tasks: completed (status=done, completedAt in range)
 *
 * Each sub-query is wrapped in try/catch so missing collections / indexes
 * degrade to 0 instead of failing the whole response.
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

function inRange(d: Date | null, from: Date, to: Date): boolean {
  if (!d) return false
  return d >= from && d <= to
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeCount(build: () => Promise<any>, filter: (data: any) => boolean): Promise<number> {
  try {
    const snap = await build()
    if (!snap || snap.empty) return 0
    let n = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap.docs.forEach((doc: any) => {
      const data = doc.data() ?? {}
      if (data.deleted === true) return
      if (filter(data)) n += 1
    })
    return n
  } catch (err) {
    console.warn('[reports/activity-summary] sub-query failed:', err)
    return 0
  }
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

  const [
    socialPosts,
    emailsSent,
    invoicesCreated,
    dealsUpdated,
    contactsAdded,
    tasksCompleted,
  ] = await Promise.all([
    safeCount(
      () =>
        adminDb
          .collection('social_posts')
          .where('orgId', '==', orgId)
          .where('status', '==', 'published')
          .get(),
      (data) => inRange(toDateSafe(data.publishedAt), from, to),
    ),
    safeCount(
      () =>
        adminDb
          .collection('emails')
          .where('status', '==', 'sent')
          .get(),
      (data) => {
        if (data.orgId && data.orgId !== orgId) return false
        return inRange(toDateSafe(data.sentAt), from, to)
      },
    ),
    safeCount(
      () => adminDb.collection('invoices').where('orgId', '==', orgId).get(),
      (data) => inRange(toDateSafe(data.createdAt), from, to),
    ),
    safeCount(
      () => adminDb.collection('deals').where('orgId', '==', orgId).get(),
      (data) => inRange(toDateSafe(data.updatedAt), from, to),
    ),
    safeCount(
      () => adminDb.collection('contacts').where('orgId', '==', orgId).get(),
      (data) => inRange(toDateSafe(data.createdAt), from, to),
    ),
    safeCount(
      () =>
        adminDb
          .collection('tasks')
          .where('orgId', '==', orgId)
          .where('status', '==', 'done')
          .get(),
      (data) => inRange(toDateSafe(data.completedAt), from, to),
    ),
  ])

  return apiSuccess({
    from: from.toISOString(),
    to: to.toISOString(),
    counts: {
      socialPosts,
      emailsSent,
      invoicesCreated,
      dealsUpdated,
      contactsAdded,
      tasksCompleted,
    },
  })
})
