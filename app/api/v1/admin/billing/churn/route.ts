import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { computeRevenueMetrics, loadSubscriptions } from '@/lib/billing/metrics'
import {
  CHURN_REASON_LABELS,
  type ChurnEvent,
  type ChurnReason,
} from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

function toMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const seconds = v.seconds ?? v._seconds
  if (typeof seconds === 'number') return seconds * 1000
  return null
}

export const GET = withAuth('admin', async () => {
  const [metrics, subs, churnSnap, orgsSnap] = await Promise.all([
    computeRevenueMetrics(),
    loadSubscriptions(),
    adminDb.collection('churn_events').get(),
    adminDb.collection('organizations').get(),
  ])

  const orgMeta = new Map<string, { name: string; slug: string }>()
  for (const doc of orgsSnap.docs) {
    const o = doc.data() as { name?: string; slug?: string; type?: string }
    if (o.type === 'platform_owner') continue
    orgMeta.set(doc.id, { name: o.name ?? doc.id, slug: o.slug ?? doc.id })
  }

  // Summary + reasons from churn_events.
  let churnedCount = 0
  let mrrLostZar = 0
  const reasonMap = new Map<ChurnReason, { count: number; mrrLostZar: number }>()
  for (const doc of churnSnap.docs) {
    const ev = doc.data() as ChurnEvent
    churnedCount += 1
    const lost = typeof ev.mrrLostZar === 'number' ? ev.mrrLostZar : 0
    mrrLostZar += lost
    const reason = (ev.reason ?? 'other') as ChurnReason
    const entry = reasonMap.get(reason) ?? { count: 0, mrrLostZar: 0 }
    entry.count += 1
    entry.mrrLostZar += lost
    reasonMap.set(reason, entry)
  }

  const reasons = (Object.keys(CHURN_REASON_LABELS) as ChurnReason[])
    .map((reason) => ({
      reason,
      label: CHURN_REASON_LABELS[reason],
      count: reasonMap.get(reason)?.count ?? 0,
      mrrLostZar: Math.round(reasonMap.get(reason)?.mrrLostZar ?? 0),
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)

  // At-risk = subscriptions past_due or paused.
  const atRisk = subs
    .filter((s) => s.status === 'past_due' || s.status === 'paused')
    .map((s) => {
      const meta = s.orgId ? orgMeta.get(s.orgId) : undefined
      const monthly =
        s.interval === 'annual'
          ? (s.priceZar ?? 0) / 12
          : s.interval === 'quarterly'
            ? (s.priceZar ?? 0) / 3
            : s.interval === 'once_off'
              ? 0
              : (s.priceZar ?? 0)
      return {
        orgId: s.orgId,
        name: meta?.name ?? s.orgId,
        slug: meta?.slug ?? s.orgId,
        reason: s.status,
        mrrZar: Math.round(monthly),
      }
    })
    .filter((r) => orgMeta.has(r.orgId))
    .sort((a, b) => b.mrrZar - a.mrrZar)

  // Cohort retention: group subs by startedAt month.
  const cohortMap = new Map<string, { startCount: number; retainedCount: number }>()
  for (const sub of subs) {
    const startedMs = toMillis(sub.startedAt)
    if (!startedMs) continue
    const d = new Date(startedMs)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const entry = cohortMap.get(key) ?? { startCount: 0, retainedCount: 0 }
    entry.startCount += 1
    if (sub.status === 'active') entry.retainedCount += 1
    cohortMap.set(key, entry)
  }
  const cohorts = Array.from(cohortMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cohortMonth, v]) => ({
      cohortMonth,
      startCount: v.startCount,
      retainedCount: v.retainedCount,
      retentionPct: v.startCount > 0 ? Math.round((v.retainedCount / v.startCount) * 100) : 0,
    }))

  return apiSuccess({
    summary: {
      churnedCount,
      mrrLostZar: Math.round(mrrLostZar),
      churnRate: metrics.churnRate,
    },
    reasons,
    atRisk,
    cohorts,
  })
})
