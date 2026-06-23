/**
 * GET /api/v1/admin/dashboard
 *
 * Real admin revenue & operations dashboard (US-250). Computes everything from
 * live Firestore data — no stubs, no mock numbers.
 *
 *  - MRR / ARR rolled up in ZAR from each active client org's adminBilling
 *    (via monthlyRecurringForOrg + toZar). Orgs without adminBilling = R0.
 *  - Org counts (active, total clients, new this month, churned + churn rate).
 *  - Total contacts, email sends today, active social accounts, failed jobs —
 *    all via Firestore .count() aggregation where only a total is needed.
 *  - Collected revenue per month (last 6 months) from paid invoices.
 *  - New client orgs per month (last 6 months) from createdAt.
 *  - 8 most recent client signups.
 *
 * Auth: super-admin only.
 */

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import {
  monthlyRecurringForOrg,
  toZar,
  type AdminBilling,
} from '@/lib/admin/billing-model'

export const dynamic = 'force-dynamic'

type FsTimestamp = { _seconds?: number; _nanoseconds?: number; seconds?: number } | Timestamp | Date | string | null | undefined

/** Read a Firestore-shaped timestamp into epoch ms, or null. */
function tsToMillis(value: FsTimestamp): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (value instanceof Timestamp) return value.toMillis()
  if (typeof value === 'object') {
    const src = value as { _seconds?: number; seconds?: number; toMillis?: () => number }
    if (typeof src.toMillis === 'function') {
      try { return src.toMillis() } catch { /* noop */ }
    }
    const seconds = src._seconds ?? src.seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

type MonthBucket = { month: string; label: string; start: number; end: number }

/** Build the last `count` calendar months (oldest first), each with [start,end) ms range. */
function lastMonths(count: number): MonthBucket[] {
  const now = new Date()
  const buckets: MonthBucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const start = d.getTime()
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('en-ZA', { month: 'short' })
    buckets.push({ month, label, start, end })
  }
  return buckets
}

interface OrgDoc {
  name?: string
  slug?: string
  type?: string
  status?: string
  plan?: string
  createdAt?: FsTimestamp
  adminBilling?: AdminBilling
}

interface InvoiceDoc {
  status?: string
  total?: number
  currency?: string
  paidAt?: FsTimestamp
}

const PAID_STATUSES = new Set(['paid', 'partially_paid'])
const COUNTABLE_EMAIL_STATUSES = ['sent', 'delivered', 'opened', 'clicked']

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) {
    return apiError('Super-admin access required', 403)
  }

  const sixMonths = lastMonths(6)
  const monthsCutoff = Timestamp.fromMillis(sixMonths[0].start)
  // Invoices: pull a slightly wider window so a paid invoice landing late still groups.
  const invoiceCutoff = Timestamp.fromMillis(
    new Date(new Date().getFullYear(), new Date().getMonth() - 6, 1).getTime(),
  )

  // Email sends today = last 24h.
  const emailCutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)

  const [
    orgsSnap,
    invoicesSnap,
    contactsCount,
    socialCount,
    emailCounts,
    failedWebhookCount,
  ] = await Promise.all([
    adminDb.collection('organizations').get(),
    adminDb.collection('invoices').where('paidAt', '>=', invoiceCutoff).get(),
    adminDb.collection('contacts').count().get(),
    adminDb.collection('social_accounts').count().get(),
    // Email sends today: count per countable status, summed below.
    Promise.all(
      COUNTABLE_EMAIL_STATUSES.map((status) =>
        adminDb
          .collection('emails')
          .where('status', '==', status)
          .where('sentAt', '>=', emailCutoff)
          .count()
          .get()
          .then((s) => s.data().count)
          .catch(() => 0),
      ),
    ),
    adminDb
      .collection('webhook_queue')
      .where('status', '==', 'failed')
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
  ])

  // ---- Organisations -------------------------------------------------------
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

  let mrrZar = 0
  let activeOrgs = 0
  let totalClientOrgs = 0
  let newOrgsThisMonth = 0
  let churnedOrgs = 0

  const acqBuckets = sixMonths.map((b) => ({ ...b, count: 0 }))
  const recentSignups: Array<{ id: string; name: string; slug: string; status: string; createdAt: number | null }> = []

  for (const doc of orgsSnap.docs) {
    const org = doc.data() as OrgDoc
    if (org.type === 'platform_owner') continue

    totalClientOrgs += 1
    const status = org.status ?? 'active'
    if (status === 'active') activeOrgs += 1
    if (status === 'churned') churnedOrgs += 1

    // MRR only from active client orgs.
    if (status === 'active') {
      const monthly = monthlyRecurringForOrg(org.adminBilling)
      if (monthly > 0) {
        mrrZar += toZar(monthly, org.adminBilling?.currency)
      }
    }

    const createdMs = tsToMillis(org.createdAt)
    if (createdMs !== null) {
      if (createdMs >= monthStart) newOrgsThisMonth += 1
      for (const bucket of acqBuckets) {
        if (createdMs >= bucket.start && createdMs < bucket.end) {
          bucket.count += 1
          break
        }
      }
    }

    recentSignups.push({
      id: doc.id,
      name: org.name ?? 'Untitled organisation',
      slug: org.slug ?? '',
      status,
      createdAt: createdMs,
    })
  }

  recentSignups.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  const mrr = Math.round(mrrZar)
  const arr = mrr * 12
  const churnDenominator = activeOrgs + churnedOrgs
  const churnRate = churnDenominator > 0 ? churnedOrgs / churnDenominator : 0

  // ---- Collected revenue per month (paid invoices) -------------------------
  const revenueBuckets = sixMonths.map((b) => ({ ...b, amount: 0 }))
  for (const doc of invoicesSnap.docs) {
    const inv = doc.data() as InvoiceDoc
    if (!PAID_STATUSES.has(inv.status ?? '')) continue
    const paidMs = tsToMillis(inv.paidAt)
    if (paidMs === null) continue
    const total = typeof inv.total === 'number' ? inv.total : 0
    if (total <= 0) continue
    const zar = toZar(total, inv.currency)
    for (const bucket of revenueBuckets) {
      if (paidMs >= bucket.start && paidMs < bucket.end) {
        bucket.amount += zar
        break
      }
    }
  }

  const emailSendsToday = emailCounts.reduce((sum, n) => sum + n, 0)

  return apiSuccess({
    mrr,
    arr,
    currency: 'ZAR' as const,
    activeOrgs,
    totalClientOrgs,
    newOrgsThisMonth,
    churnedOrgs,
    churnRate,
    totalContacts: contactsCount.data().count,
    emailSendsToday,
    activeSocialAccounts: socialCount.data().count,
    failedJobs: failedWebhookCount,
    revenueByMonth: revenueBuckets.map((b) => ({
      month: b.month,
      label: b.label,
      amount: Math.round(b.amount),
    })),
    acquisitionByMonth: acqBuckets.map((b) => ({
      month: b.month,
      label: b.label,
      count: b.count,
    })),
    recentSignups: recentSignups.slice(0, 8).map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      createdAt: s.createdAt,
    })),
  })
})
