/**
 * GET /api/v1/crm/dashboard
 * Returns aggregated CRM metrics for the org.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Activity, Contact, Deal } from '@/lib/crm/types'
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

const GROWTH_MONTHS = 6

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
    const [dealsSnap, activitiesSnap, contactsSnap] = await Promise.all([
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
      adminDb
        .collection('contacts')
        .where('orgId', '==', orgId)
        .limit(5000)
        .get(),
    ])

    let deals = (dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Deal & { deleted?: boolean }>)
      .filter((d) => d.deleted !== true)
    let activities = (activitiesSnap.docs.map((d): DashboardActivity => ({ id: d.id, ...d.data() })) as Array<Activity & DashboardActivity>)
      .filter((activity) => activity.deleted !== true)
    let contacts = (contactsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Contact & { deleted?: boolean }>)
      .filter((c) => c.deleted !== true)

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
      const contactAssignments = await loadContactAssignmentMap(orgId, contactIds)
      for (const contact of contactAssignments.values()) {
        for (const companyId of crmRecordCompanyIds(contact)) companyIds.add(companyId)
      }
      const companies = await loadCompanyAssignmentMap(orgId, companyIds)
      deals = filterCrmRowsForActor(ctx, deals, { contacts: contactAssignments, companies })
      activities = filterCrmRowsForActor(ctx, activities, { contacts: contactAssignments, companies })
      // Contacts carry their own assignment metadata, so they filter directly.
      contacts = filterCrmRowsForActor(ctx, contacts, { companies })
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

    // ── Contact metrics (US-072) ──────────────────────────────────────────────
    const totalContacts = contacts.length

    const newThisMonth = contacts.filter((c) => {
      const createdAt = toDate(c.createdAt)
      return createdAt !== null && createdAt >= monthStart
    }).length

    // Active leads: still in the pipeline (lead/prospect, not won or lost out).
    const activeLeads = contacts.filter(
      (c) =>
        (c.type === 'lead' || c.type === 'prospect') &&
        c.stage !== 'won' &&
        c.stage !== 'lost',
    ).length

    // Conversion rate: share of contacts that have become clients.
    const convertedClients = contacts.filter((c) => c.type === 'client').length
    const conversionRate = totalContacts > 0 ? convertedClients / totalContacts : 0

    // ── Growth over time: contacts created per month (last GROWTH_MONTHS) ──────
    const growthBuckets: Array<{ label: string; value: number; start: number; end: number }> = []
    for (let i = GROWTH_MONTHS - 1; i >= 0; i--) {
      const bucketStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const bucketEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      growthBuckets.push({
        label: bucketStart.toLocaleDateString('en-ZA', { month: 'short' }),
        value: 0,
        start: bucketStart.getTime(),
        end: bucketEnd.getTime(),
      })
    }
    for (const c of contacts) {
      const createdAt = toDate(c.createdAt)
      if (!createdAt) continue
      const ms = createdAt.getTime()
      const bucket = growthBuckets.find((b) => ms >= b.start && ms < b.end)
      if (bucket) bucket.value += 1
    }
    const contactGrowth = growthBuckets.map((b) => ({ label: b.label, value: b.value }))

    // ── Source breakdown: group by utmSource ("Direct / Unknown" for empty) ────
    const sourceCounts = new Map<string, number>()
    for (const c of contacts) {
      const raw = typeof c.utmSource === 'string' ? c.utmSource.trim() : ''
      const key = raw || 'Direct / Unknown'
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1)
    }
    const sourceBreakdown = Array.from(sourceCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

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
      // Contact-centric metrics (US-072)
      totalContacts,
      newThisMonth,
      activeLeads,
      convertedClients,
      conversionRate,
      contactGrowth,
      sourceBreakdown,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
