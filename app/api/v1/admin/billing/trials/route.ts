import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadSubscriptions, toMonthlyZar } from '@/lib/billing/metrics'
import type { Subscription } from '@/lib/billing/types'

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

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Activation score (0-100) built from REAL usage signals for the org during
 * its trial window. Weighted sum, normalised:
 *   - activities count in trial window (cap 20)  → 40 pts
 *   - has any social post                        → 20 pts
 *   - has any invoice                            → 15 pts
 *   - has >1 team member (collaboration)         → 15 pts
 *   - trial recency / engagement: activity in last 7d → 10 pts
 */
function computeActivationScore(signals: {
  activityCount: number
  hasSocialPost: boolean
  hasInvoice: boolean
  teamSize: number
  recentlyActive: boolean
}): number {
  const activityPts = Math.min(signals.activityCount, 20) / 20 * 40
  const socialPts = signals.hasSocialPost ? 20 : 0
  const invoicePts = signals.hasInvoice ? 15 : 0
  const teamPts = signals.teamSize > 1 ? 15 : signals.teamSize === 1 ? 5 : 0
  const recentPts = signals.recentlyActive ? 10 : 0
  return Math.round(Math.min(100, activityPts + socialPts + invoicePts + teamPts + recentPts))
}

export const GET = withAuth('admin', async () => {
  const subs = await loadSubscriptions()
  const trialing = subs.filter((s) => s.status === 'trialing' && s.orgId)

  const now = Date.now()
  const sevenDaysAgo = now - 7 * DAY_MS

  // Org metadata (skip platform_owner).
  const orgsSnap = await adminDb.collection('organizations').get()
  const orgMeta = new Map<string, { name: string; slug: string }>()
  for (const doc of orgsSnap.docs) {
    const o = doc.data() as { name?: string; slug?: string; type?: string }
    if (o.type === 'platform_owner') continue
    orgMeta.set(doc.id, { name: o.name ?? doc.id, slug: o.slug ?? doc.id })
  }

  // Per-trial signal lookups, run in parallel per org.
  const trials = await Promise.all(
    trialing.map(async (sub) => {
      const orgId = sub.orgId
      const startedMs = toMillis(sub.startedAt) ?? toMillis(sub.createdAt) ?? now
      const trialEndsMs = toMillis(sub.trialEndsAt)

      const [actSnap, socialSnap, invSnap, membersSnap] = await Promise.all([
        adminDb.collection('activities').where('orgId', '==', orgId).limit(50).get(),
        adminDb.collection('social_posts').where('orgId', '==', orgId).limit(1).get(),
        adminDb.collection('invoices').where('orgId', '==', orgId).limit(1).get(),
        adminDb.collection('orgMembers').where('orgId', '==', orgId).limit(20).get(),
      ])

      // Count activities that fall within the trial window (>= startedMs).
      let activityCount = 0
      let recentlyActive = false
      for (const d of actSnap.docs) {
        const ms = toMillis((d.data() as { createdAt?: unknown }).createdAt)
        if (ms == null) continue
        if (ms >= startedMs) activityCount += 1
        if (ms >= sevenDaysAgo) recentlyActive = true
      }

      const activationScore = computeActivationScore({
        activityCount,
        hasSocialPost: !socialSnap.empty,
        hasInvoice: !invSnap.empty,
        teamSize: membersSnap.size,
        recentlyActive,
      })

      const monthly = toMonthlyZar(sub.priceZar ?? 0, sub.interval ?? 'monthly')
      const daysRemaining =
        trialEndsMs != null ? Math.ceil((trialEndsMs - now) / DAY_MS) : null
      const meta = orgMeta.get(orgId)

      return {
        orgId,
        orgName: meta?.name ?? orgId,
        slug: meta?.slug ?? orgId,
        planKey: sub.planKey ?? 'unknown',
        interval: sub.interval ?? 'monthly',
        priceZar: sub.priceZar ?? 0,
        mrrPotentialZar: Math.round(monthly),
        trialEndsAtMs: trialEndsMs,
        daysRemaining,
        activationScore,
        signals: {
          activityCount,
          hasSocialPost: !socialSnap.empty,
          hasInvoice: !invSnap.empty,
          teamSize: membersSnap.size,
          recentlyActive,
        },
      }
    }),
  )

  // Summary aggregates.
  const total = trials.length
  const convertingSoon = trials.filter(
    (t) => t.daysRemaining != null && t.daysRemaining <= 3,
  ).length
  const avgActivation =
    total > 0
      ? Math.round(trials.reduce((s, t) => s + t.activationScore, 0) / total)
      : 0
  const mrrPotentialZar = Math.round(
    trials.reduce((s, t) => s + t.mrrPotentialZar, 0),
  )

  // Conversion trend: trials started vs converted per month (last 12 months).
  // Approximate from ALL subscriptions using startedAt month. A sub that is now
  // active and started in month M counts as a conversion for M; a sub that
  // started in M (any status) counts as a trial start for M.
  const buckets = new Map<string, { started: number; converted: number }>()
  const nowDate = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, {
      started: 0,
      converted: 0,
    })
  }
  for (const sub of subs as Subscription[]) {
    const startedMs = toMillis(sub.startedAt) ?? toMillis(sub.createdAt)
    if (startedMs == null) continue
    const d = new Date(startedMs)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.started += 1
    if (sub.status === 'active' || sub.status === 'past_due') bucket.converted += 1
  }
  const conversionTrend = Array.from(buckets.entries()).map(([month, v]) => ({
    month,
    started: v.started,
    converted: v.converted,
  }))

  return apiSuccess({
    trials,
    summary: { total, convertingSoon, avgActivation, mrrPotentialZar },
    conversionTrend,
  })
})
