/**
 * Revenue + subscription metrics, computed from REAL Firestore data.
 *
 * MRR/ARR/churn/expansion are derived from `subscriptions` (platform-managed
 * plan records) and corroborated against paid `invoices`. There is no Stripe;
 * all figures are ZAR.
 */
import { adminDb } from '@/lib/firebase/admin'
import type { Subscription } from './types'
import type { BillingInterval } from '@/lib/plans/types'

export interface RevenueMetrics {
  mrrZar: number
  arrZar: number
  activeSubscriptions: number
  trialingSubscriptions: number
  pastDueSubscriptions: number
  /** MRR added from new subscriptions in the trailing 30 days */
  newMrrZar: number
  /** MRR lost from cancellations in the trailing 30 days */
  churnedMrrZar: number
  /** Net expansion (upgrades − downgrades) in the trailing 30 days */
  expansionMrrZar: number
  /** Logo churn rate over trailing 30 days (0-1) */
  churnRate: number
  /** Total collected (paid invoices) in trailing 30 days */
  collected30dZar: number
}

/** Normalise any interval price to a monthly-recurring ZAR figure. */
export function toMonthlyZar(priceZar: number, interval: BillingInterval): number {
  switch (interval) {
    case 'monthly':
      return priceZar
    case 'quarterly':
      return priceZar / 3
    case 'annual':
      return priceZar / 12
    case 'once_off':
      return 0
    default:
      return priceZar
  }
}

function toMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const seconds = v.seconds ?? v._seconds
  if (typeof seconds === 'number') return seconds * 1000
  return null
}

export async function loadSubscriptions(): Promise<Subscription[]> {
  const snap = await adminDb.collection('subscriptions').get()
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Subscription) }))
}

export async function computeRevenueMetrics(): Promise<RevenueMetrics> {
  const subs = await loadSubscriptions()
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

  let mrrZar = 0
  let activeSubscriptions = 0
  let trialingSubscriptions = 0
  let pastDueSubscriptions = 0
  let newMrrZar = 0
  let churnedMrrZar = 0
  let activeAtPeriodStart = 0
  let churnedInWindow = 0

  for (const sub of subs) {
    const monthly = toMonthlyZar(sub.priceZar ?? 0, sub.interval ?? 'monthly')
    const startedMs = toMillis(sub.startedAt)
    const cancelledMs = toMillis(sub.cancelledAt)

    if (sub.status === 'active') {
      mrrZar += monthly
      activeSubscriptions += 1
    } else if (sub.status === 'trialing') {
      trialingSubscriptions += 1
    } else if (sub.status === 'past_due') {
      pastDueSubscriptions += 1
      mrrZar += monthly // still owed
    }

    if (startedMs && startedMs >= thirtyDaysAgo && sub.status === 'active') {
      newMrrZar += monthly
    }
    if (cancelledMs && cancelledMs >= thirtyDaysAgo) {
      churnedMrrZar += monthly
      churnedInWindow += 1
    }
    // Was the sub active at the start of the window?
    if (startedMs && startedMs < thirtyDaysAgo && (!cancelledMs || cancelledMs >= thirtyDaysAgo)) {
      activeAtPeriodStart += 1
    }
  }

  // Expansion: net monthly delta from subscription_changes audit in window.
  let expansionMrrZar = 0
  try {
    const changesSnap = await adminDb
      .collection('subscription_changes')
      .where('createdAtMs', '>=', thirtyDaysAgo)
      .get()
    for (const doc of changesSnap.docs) {
      const d = doc.data() as { deltaMrrZar?: number }
      if (typeof d.deltaMrrZar === 'number') expansionMrrZar += d.deltaMrrZar
    }
  } catch {
    // collection may not exist yet; expansion stays 0
  }

  // Collected in trailing 30 days from paid invoices.
  let collected30dZar = 0
  try {
    const paidSnap = await adminDb
      .collection('invoices')
      .where('status', '==', 'paid')
      .get()
    for (const doc of paidSnap.docs) {
      const inv = doc.data() as { paidAt?: unknown; paidAmount?: number; total?: number; currency?: string }
      const paidMs = toMillis(inv.paidAt)
      if (paidMs && paidMs >= thirtyDaysAgo) {
        const amt = typeof inv.paidAmount === 'number' ? inv.paidAmount : (inv.total ?? 0)
        // Only count ZAR; mixed-currency totals would be misleading.
        if (!inv.currency || inv.currency === 'ZAR') collected30dZar += amt
      }
    }
  } catch {
    // ignore
  }

  const churnRate = activeAtPeriodStart > 0 ? churnedInWindow / activeAtPeriodStart : 0

  return {
    mrrZar: Math.round(mrrZar),
    arrZar: Math.round(mrrZar * 12),
    activeSubscriptions,
    trialingSubscriptions,
    pastDueSubscriptions,
    newMrrZar: Math.round(newMrrZar),
    churnedMrrZar: Math.round(churnedMrrZar),
    expansionMrrZar: Math.round(expansionMrrZar),
    churnRate,
    collected30dZar: Math.round(collected30dZar),
  }
}

/** Build a monthly collected-revenue trend for the last N months. */
export async function computeRevenueTrend(months = 12): Promise<{ month: string; collectedZar: number }[]> {
  const paidSnap = await adminDb.collection('invoices').where('status', '==', 'paid').get()
  const buckets = new Map<string, number>()
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0)
  }
  for (const doc of paidSnap.docs) {
    const inv = doc.data() as { paidAt?: unknown; paidAmount?: number; total?: number; currency?: string }
    if (inv.currency && inv.currency !== 'ZAR') continue
    const paidMs = toMillis(inv.paidAt)
    if (!paidMs) continue
    const d = new Date(paidMs)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (buckets.has(key)) {
      const amt = typeof inv.paidAmount === 'number' ? inv.paidAmount : (inv.total ?? 0)
      buckets.set(key, (buckets.get(key) ?? 0) + amt)
    }
  }
  return Array.from(buckets.entries()).map(([month, collectedZar]) => ({
    month,
    collectedZar: Math.round(collectedZar),
  }))
}
