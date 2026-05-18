/**
 * GET /api/v1/crm/reports/rep-performance
 * Returns owner/rep performance from tenant deals and CRM activities.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Deal, Activity } from '@/lib/crm/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export const dynamic = 'force-dynamic'

interface RepRow {
  uid: string
  displayName: string
  openDeals: number
  wonDeals: number
  lostDeals: number
  openValue: number
  wonValue: number
  activities: number
}

function repKey(ref: MemberRef | undefined, uid: string | undefined): { uid: string; displayName: string } {
  if (ref?.uid) return { uid: ref.uid, displayName: ref.displayName || ref.uid }
  const fallback = uid || 'unassigned'
  return { uid: fallback, displayName: fallback === 'unassigned' ? 'Unassigned' : fallback }
}

function ensureRow(rows: Map<string, RepRow>, uid: string, displayName: string): RepRow {
  const existing = rows.get(uid)
  if (existing) return existing
  const row: RepRow = {
    uid,
    displayName,
    openDeals: 0,
    wonDeals: 0,
    lostDeals: 0,
    openValue: 0,
    wonValue: 0,
    activities: 0,
  }
  rows.set(uid, row)
  return row
}

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const [dealsSnap, activitiesSnap] = await Promise.all([
      adminDb.collection('deals')
        .where('orgId', '==', ctx.orgId)
        .limit(2000)
        .get(),
      adminDb.collection('activities')
        .where('orgId', '==', ctx.orgId)
        .limit(2000)
        .get(),
    ])

    const rows = new Map<string, RepRow>()
    const deals = dealsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Deal)
      .filter((deal) => deal.deleted !== true)

    for (const deal of deals) {
      const rep = repKey(deal.ownerRef, deal.ownerUid ?? deal.createdBy)
      const row = ensureRow(rows, rep.uid, rep.displayName)
      const value = deal.value ?? 0
      if (deal.lostReason) {
        row.lostDeals += 1
      } else if ((deal.probability ?? 50) >= 100) {
        row.wonDeals += 1
        row.wonValue += value
      } else {
        row.openDeals += 1
        row.openValue += value
      }
    }

    const activities = activitiesSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Activity)

    for (const activity of activities) {
      const rep = repKey(activity.createdByRef, activity.createdBy)
      const row = ensureRow(rows, rep.uid, rep.displayName)
      row.activities += 1
    }

    const reps = [...rows.values()]
      .map((row) => ({
        ...row,
        winRate: row.wonDeals + row.lostDeals > 0
          ? row.wonDeals / (row.wonDeals + row.lostDeals)
          : null,
      }))
      .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue || b.activities - a.activities)

    return apiSuccess({
      reps,
      summary: {
        repCount: reps.length,
        totalWonValue: reps.reduce((sum, rep) => sum + rep.wonValue, 0),
        totalOpenValue: reps.reduce((sum, rep) => sum + rep.openValue, 0),
        totalActivities: reps.reduce((sum, rep) => sum + rep.activities, 0),
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
