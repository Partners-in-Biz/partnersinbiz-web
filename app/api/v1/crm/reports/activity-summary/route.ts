/**
 * GET /api/v1/crm/reports/activity-summary?days=30
 * Returns activity counts grouped by type and day for the org.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Activity } from '@/lib/crm/types'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

function toDateString(ts: Activity['createdAt']): string {
  if (!ts) return 'unknown'
  let date: Date
  if (typeof (ts as unknown as { toDate?: unknown }).toDate === 'function') {
    date = (ts as unknown as { toDate: () => Date }).toDate()
  } else {
    date = new Date(ts as unknown as string)
  }
  // YYYY-MM-DD
  return date.toISOString().slice(0, 10)
}

export const GET = withCrmAuth('member', async (req: NextRequest, ctx) => {
  const { orgId } = ctx

  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90)
    const since = new Date(Date.now() - days * 86_400_000)

    const snap = await adminDb
      .collection('activities')
      .where('orgId', '==', orgId)
      .where('createdAt', '>=', Timestamp.fromDate(since))
      .get()

    const activities = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Activity[]

    // Group by type
    const byType: Record<string, number> = {}
    // Group by YYYY-MM-DD
    const perDayMap: Record<string, number> = {}

    for (const a of activities) {
      const type = a.type ?? 'unknown'
      byType[type] = (byType[type] ?? 0) + 1

      const day = toDateString(a.createdAt)
      perDayMap[day] = (perDayMap[day] ?? 0) + 1
    }

    // Sort perDay ascending
    const perDay = Object.entries(perDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))

    return apiSuccess({
      days,
      since: since.toISOString(),
      byType,
      total: activities.length,
      perDay,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
