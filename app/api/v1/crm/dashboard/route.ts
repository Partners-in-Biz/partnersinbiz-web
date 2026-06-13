/**
 * GET /api/v1/crm/dashboard
 * Returns aggregated CRM metrics for the org.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Activity, Deal } from '@/lib/crm/types'
import {
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

type DashboardActivity = { id: string; createdAt?: unknown } & Record<string, unknown>

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate()
  const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000)
  return null
}

export const GET = withCrmAuth('member', async (_req, ctx) => {
  const { orgId } = ctx

  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Keep these reads index-light. The dashboard is a summary surface, so it is
    // safer to filter/sort the bounded tenant result in memory than to require
    // every fresh workspace to have composite indexes deployed first.
    const [dealsSnap, activitiesSnap] = await Promise.all([
      adminDb
        .collection('deals')
        .where('orgId', '==', orgId)
        .limit(1000)
        .get(),
      adminDb
        .collection('activities')
        .where('orgId', '==', orgId)
        .limit(100)
        .get(),
    ])

    let deals = (dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Deal & { deleted?: boolean }>)
      .filter((d) => d.deleted !== true)
    let activities = (activitiesSnap.docs.map((d): DashboardActivity => ({ id: d.id, ...d.data() })) as Array<Activity & DashboardActivity>)
      .filter((activity) => activity.deleted !== true)

    if (!isCrmPrivilegedActor(ctx)) {
      const contactIds = new Set<string>()
      const companyIds = new Set<string>()
      for (const deal of deals) {
        for (const contactId of crmRecordContactIds(deal)) contactIds.add(contactId)
        for (const companyId of crmRecordCompanyIds(deal)) companyIds.add(companyId)
      }
      for (const activity of activities) {
        for (const contactId of crmRecordContactIds(activity)) contactIds.add(contactId)
        for (const companyId of crmRecordCompanyIds(activity)) companyIds.add(companyId)
      }
      const contacts = await loadContactAssignmentMap(orgId, contactIds)
      for (const contact of contacts.values()) {
        for (const companyId of crmRecordCompanyIds(contact)) companyIds.add(companyId)
      }
      const companies = await loadCompanyAssignmentMap(orgId, companyIds)
      deals = filterCrmRowsForActor(ctx, deals, { contacts, companies })
      activities = filterCrmRowsForActor(ctx, activities, { contacts, companies })
    }

    // Classify deals using probability heuristic:
    //   - probability === 100 → won
    //   - lostReason present  → lost
    //   - else                → open
    const open = deals.filter((d) => !d.lostReason && (d.probability ?? 50) < 100)

    const wonThisMonth = deals.filter((d) => {
      const updatedAt = toDate(d.updatedAt)
      return d.probability === 100 && updatedAt !== null && updatedAt >= monthStart
    })

    const lostThisMonth = deals.filter((d) => {
      const updatedAt = toDate(d.updatedAt)
      return !!d.lostReason && updatedAt !== null && updatedAt >= monthStart
    })

    const openDealsCount = open.length
    const openDealsValue = open.reduce((s, d) => s + (d.value ?? 0), 0)
    const weightedPipelineValue = open.reduce(
      (s, d) => s + (d.value ?? 0) * ((d.probability ?? 50) / 100),
      0,
    )
    const topOpenDeals = [...open]
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 5)

    const recentActivities = activities
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0))
      .slice(0, 10)

    return apiSuccess({
      openDealsCount,
      openDealsValue,
      weightedPipelineValue,
      wonThisMonth: {
        count: wonThisMonth.length,
        value: wonThisMonth.reduce((s, d) => s + (d.value ?? 0), 0),
      },
      lostThisMonth: {
        count: lostThisMonth.length,
      },
      recentActivities,
      topOpenDeals,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
