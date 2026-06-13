/**
 * GET /api/v1/crm/reports/activity-summary?days=30
 * Returns activity counts grouped by type and day for the org.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Activity } from '@/lib/crm/types'
import { NextRequest } from 'next/server'
import {
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

type ActivityRow = Activity & { deleted?: boolean }

function toDate(ts: Activity['createdAt']): Date | null {
  if (!ts) return null
  const date = typeof (ts as unknown as { toDate?: unknown }).toDate === 'function'
    ? (ts as unknown as { toDate: () => Date }).toDate()
    : new Date(ts as unknown as string)

  return Number.isNaN(date.getTime()) ? null : date
}

function toDateString(date: Date): string {
  // YYYY-MM-DD
  return date.toISOString().slice(0, 10)
}

export const GET = withCrmAuth('member', async (req: NextRequest, ctx) => {
  const { orgId } = ctx

  try {
    const { searchParams } = new URL(req.url)
    const parsedDays = parseInt(searchParams.get('days') ?? '30', 10)
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 90) : 30
    const since = new Date(Date.now() - days * 86_400_000)

    const snap = await adminDb
      .collection('activities')
      .where('orgId', '==', orgId)
      .limit(2000)
      .get()

    let activityRows = (snap.docs
      .map((d) => ({ id: d.id, ...d.data() })) as ActivityRow[])
      .filter((activity) => activity.deleted !== true)
    if (!isCrmPrivilegedActor(ctx)) {
      const contacts = await loadContactAssignmentMap(orgId, activityRows.flatMap((activity) => crmRecordContactIds(activity)))
      const companyIds = new Set<string>()
      for (const activity of activityRows) {
        for (const companyId of crmRecordCompanyIds(activity)) companyIds.add(companyId)
        for (const contactId of crmRecordContactIds(activity)) {
          for (const companyId of crmRecordCompanyIds(contacts.get(contactId))) companyIds.add(companyId)
        }
      }
      const companies = await loadCompanyAssignmentMap(orgId, companyIds)
      activityRows = filterCrmRowsForActor(ctx, activityRows, { contacts, companies })
    }

    const activities = activityRows
      .map((activity) => ({ activity, createdAt: toDate(activity.createdAt) }))
      .filter(({ createdAt }) => createdAt !== null && createdAt >= since)

    // Group by type
    const byType: Record<string, number> = {}
    // Group by YYYY-MM-DD
    const perDayMap: Record<string, number> = {}

    for (const { activity, createdAt } of activities) {
      if (!createdAt) continue
      const type = activity.type ?? 'unknown'
      byType[type] = (byType[type] ?? 0) + 1

      const day = toDateString(createdAt)
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
