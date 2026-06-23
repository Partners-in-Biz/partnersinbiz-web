import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  computeRevenueMetrics,
  computeRevenueTrend,
  toMonthlyZar,
  loadSubscriptions,
} from '@/lib/billing/metrics'
import type { Plan } from '@/lib/plans/types'

export const dynamic = 'force-dynamic'

function invoiceMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const seconds = v.seconds ?? v._seconds
  if (typeof seconds === 'number') return seconds * 1000
  return null
}

export const GET = withAuth('admin', async () => {
  const [metrics, trend, subs, plansSnap, orgsSnap, paidSnap] = await Promise.all([
    computeRevenueMetrics(),
    computeRevenueTrend(12),
    loadSubscriptions(),
    adminDb.collection('plans').get(),
    adminDb.collection('organizations').get(),
    adminDb.collection('invoices').where('status', '==', 'paid').get(),
  ])

  // Plan name lookup keyed by plan key.
  const planNameByKey = new Map<string, string>()
  for (const doc of plansSnap.docs) {
    const p = doc.data() as Plan
    if (p.key) planNameByKey.set(p.key, p.name ?? p.key)
  }

  // Plan distribution from ACTIVE subscriptions grouped by planKey.
  const distMap = new Map<string, { count: number; mrrZar: number }>()
  for (const sub of subs) {
    if (sub.status !== 'active') continue
    const key = sub.planKey ?? 'unknown'
    const entry = distMap.get(key) ?? { count: 0, mrrZar: 0 }
    entry.count += 1
    entry.mrrZar += toMonthlyZar(sub.priceZar ?? 0, sub.interval ?? 'monthly')
    distMap.set(key, entry)
  }
  const planDistribution = Array.from(distMap.entries())
    .map(([planKey, v]) => ({
      planKey,
      planName: planNameByKey.get(planKey) ?? planKey,
      count: v.count,
      mrrZar: Math.round(v.mrrZar),
    }))
    .sort((a, b) => b.mrrZar - a.mrrZar)

  // Org metadata (skip platform_owner).
  const orgMeta = new Map<string, { name: string; slug: string }>()
  for (const doc of orgsSnap.docs) {
    const o = doc.data() as { name?: string; slug?: string; type?: string }
    if (o.type === 'platform_owner') continue
    orgMeta.set(doc.id, { name: o.name ?? doc.id, slug: o.slug ?? doc.id })
  }

  // Lifetime paid revenue (ZAR) grouped by orgId.
  const lifetimeByOrg = new Map<string, number>()
  for (const doc of paidSnap.docs) {
    const inv = doc.data() as {
      orgId?: string
      paidAmount?: number
      total?: number
      currency?: string
    }
    if (inv.currency && inv.currency !== 'ZAR') continue
    if (!inv.orgId) continue
    const amt = typeof inv.paidAmount === 'number' ? inv.paidAmount : (inv.total ?? 0)
    lifetimeByOrg.set(inv.orgId, (lifetimeByOrg.get(inv.orgId) ?? 0) + amt)
  }

  // Active MRR per org for enrichment.
  const mrrByOrg = new Map<string, number>()
  for (const sub of subs) {
    if (sub.status !== 'active') continue
    if (!sub.orgId) continue
    mrrByOrg.set(
      sub.orgId,
      (mrrByOrg.get(sub.orgId) ?? 0) + toMonthlyZar(sub.priceZar ?? 0, sub.interval ?? 'monthly'),
    )
  }

  const topOrgs = Array.from(lifetimeByOrg.entries())
    .filter(([orgId]) => orgMeta.has(orgId))
    .map(([orgId, lifetimeZar]) => {
      const meta = orgMeta.get(orgId)!
      return {
        orgId,
        name: meta.name,
        slug: meta.slug,
        lifetimeZar: Math.round(lifetimeZar),
        mrrZar: Math.round(mrrByOrg.get(orgId) ?? 0),
      }
    })
    .sort((a, b) => b.lifetimeZar - a.lifetimeZar)
    .slice(0, 10)

  return apiSuccess({ metrics, trend, planDistribution, topOrgs })
})
