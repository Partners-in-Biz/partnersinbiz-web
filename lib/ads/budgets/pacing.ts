// lib/ads/budgets/pacing.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdBudget } from './types'

/** Source field convention from metrics: '{platform}_ads' (meta_ads/google_ads/linkedin_ads/tiktok_ads) */
function sourceForPlatform(p: AdBudget['platform']): string | undefined {
  if (!p) return undefined
  return `${p}_ads`
}

/** Convert a YYYY-MM-DD date string to a Date for comparison. */
function dateStringToDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`)
}

/** Query the metrics collection + sum spend_cents within scope + window. */
export async function sumSpendInScope(budget: AdBudget, windowStart: Timestamp): Promise<number> {
  let q = adminDb.collection('metrics')
    .where('orgId', '==', budget.orgId)
    .where('metric', '==', 'spend_cents') as FirebaseFirestore.Query

  if (budget.platform) {
    const source = sourceForPlatform(budget.platform)
    if (source) q = q.where('source', '==', source)
  }
  if (budget.campaignId) {
    q = q.where('level', '==', 'campaign').where('dimensionId', '==', budget.campaignId)
  }

  const snap = await q.get()
  // Filter date >= windowStart in-memory (avoids needing a composite index per scope)
  const startDate = windowStart.toDate ? windowStart.toDate() : new Date((windowStart as unknown as { _seconds: number })._seconds * 1000)
  let total = 0
  for (const doc of snap.docs) {
    const data = doc.data() as { date?: string; value?: number }
    if (typeof data.date !== 'string') continue
    if (dateStringToDate(data.date) < startDate) continue
    if (typeof data.value === 'number') total += data.value
  }
  return total
}

export interface CheckResult {
  spendCents: number
  percent: number
  newThresholds: number[]
  exhausted: boolean
  shouldAutoPause: boolean
}

export function computeCheck(budget: AdBudget, spendCents: number): CheckResult {
  const percent = budget.capCents > 0 ? (spendCents / budget.capCents) * 100 : 0
  const fired = budget.firedThresholds ?? []
  const newThresholds = budget.alertThresholds.filter((t) => percent >= t && !fired.includes(t))
  const exhausted = percent >= 100
  const alreadyPaused = (budget.pausedCampaignIds ?? []).length > 0
  const shouldAutoPause = budget.autoPause && exhausted && !alreadyPaused
  return { spendCents, percent, newThresholds, exhausted, shouldAutoPause }
}
