/**
 * GET /api/v1/admin/org/[slug]/health (US-321)
 *
 * Gathers live HealthInputs from Firestore (engagement / billing / usage
 * signals), computes the documented health score, and persists today's snapshot
 * to `organizations/{id}/health_history/{yyyy-mm-dd}` (idempotent by date-id) so
 * the history chart accumulates real data. Returns the score result + the last
 * ~30 daily snapshots.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { computeHealthScore, type HealthInputs } from '@/lib/admin/health-score'
import type { AdminBilling } from '@/lib/admin/billing-model'
import { resolveOrgBySlug, resolveOwnerUid } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

const OVERDUE_STATUSES = ['overdue', 'past_due']
const COUNTABLE_EMAIL_STATUSES = ['sent', 'delivered', 'opened', 'clicked']

async function safeCount(query: FirebaseFirestore.Query): Promise<number> {
  try {
    return (await query.count().get()).data().count
  } catch {
    return 0
  }
}

function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / (24 * 60 * 60 * 1000)))
}

function tsToMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'object') {
    const seconds = (value as { _seconds?: number; seconds?: number })._seconds
      ?? (value as { seconds?: number }).seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function billingStateToHealth(state: AdminBilling['state'] | undefined): HealthInputs['billingState'] {
  switch (state) {
    case 'active': return 'active'
    case 'trial': return 'trial'
    case 'past_due': return 'past_due'
    case 'paused': return 'paused'
    case 'cancelled': return 'cancelled'
    default: return 'unknown'
  }
}

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const now = Date.now()
  const cutoff30d = Timestamp.fromMillis(now - 30 * 24 * 60 * 60 * 1000)

  // ---- Engagement -----------------------------------------------------------
  const [socialPosts30d, emailSends30d, activityEvents30d] = await Promise.all([
    safeCount(
      adminDb.collection('social_posts').where('orgId', '==', id).where('createdAt', '>=', cutoff30d),
    ),
    Promise.all(
      COUNTABLE_EMAIL_STATUSES.map((status) =>
        safeCount(
          adminDb.collection('emails').where('orgId', '==', id)
            .where('status', '==', status).where('sentAt', '>=', cutoff30d),
        ),
      ),
    ).then((c) => c.reduce((a, b) => a + b, 0)),
    safeCount(
      adminDb.collection('activities').where('orgId', '==', id).where('createdAt', '>=', cutoff30d),
    ),
  ])

  // Last login: most recent member sign-in.
  const members = org.members ?? []
  let lastLoginMs: number | null = null
  await Promise.all(
    members.slice(0, 25).map(async (m) => {
      try {
        const authUser = await adminAuth.getUser(m.userId)
        const t = authUser.metadata.lastSignInTime ? Date.parse(authUser.metadata.lastSignInTime) : null
        if (t && (lastLoginMs === null || t > lastLoginMs)) lastLoginMs = t
      } catch {
        /* skip */
      }
    }),
  )
  const lastLoginDaysAgo = lastLoginMs !== null ? daysBetween(lastLoginMs, now) : null

  // ---- Billing --------------------------------------------------------------
  const billing = org.adminBilling
  let overdueInvoices = 0
  let latestPaidMs: number | null = null
  try {
    const invSnap = await adminDb.collection('invoices').where('orgId', '==', id).get()
    for (const d of invSnap.docs) {
      const inv = d.data()
      const status = typeof inv.status === 'string' ? inv.status : ''
      if (OVERDUE_STATUSES.includes(status)) overdueInvoices += 1
      if ((status === 'paid' || status === 'partially_paid')) {
        const paidMs = tsToMillis(inv.paidAt)
        if (paidMs && (latestPaidMs === null || paidMs > latestPaidMs)) latestPaidMs = paidMs
      }
    }
  } catch {
    /* leave zeros */
  }
  const daysSinceLastPayment = latestPaidMs !== null ? daysBetween(latestPaidMs, now) : null

  // ---- Usage ----------------------------------------------------------------
  const [contactsCount, connectedSocialAccounts, activeProjects, campaigns] = await Promise.all([
    safeCount(adminDb.collection('contacts').where('orgId', '==', id)),
    safeCount(adminDb.collection('social_accounts').where('orgId', '==', id)),
    safeCount(adminDb.collection('projects').where('orgId', '==', id)),
    safeCount(adminDb.collection('campaigns').where('orgId', '==', id)),
  ])

  const inputs: HealthInputs = {
    socialPosts30d,
    emailSends30d,
    activityEvents30d,
    lastLoginDaysAgo,
    billingState: billingStateToHealth(billing?.state),
    overdueInvoices,
    daysSinceLastPayment,
    contactsCount,
    connectedSocialAccounts,
    activeProjects,
    campaigns,
  }

  const result = computeHealthScore(inputs)

  // ---- Persist today's snapshot (idempotent by date id) ---------------------
  const today = new Date().toISOString().slice(0, 10) // yyyy-mm-dd
  try {
    await adminDb
      .collection('organizations').doc(id)
      .collection('health_history').doc(today)
      .set({ score: result.score, band: result.band, at: new Date().toISOString() }, { merge: true })
  } catch (err) {
    console.error('[org-health] snapshot write failed', err)
  }

  // ---- Read history (last ~30 days) -----------------------------------------
  let history: Array<{ date: string; score: number; band: string }> = []
  try {
    const histSnap = await adminDb
      .collection('organizations').doc(id)
      .collection('health_history').get()
    history = histSnap.docs
      .map((d) => {
        const data = d.data()
        return {
          date: d.id,
          score: typeof data.score === 'number' ? data.score : 0,
          band: typeof data.band === 'string' ? data.band : 'watch',
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
  } catch {
    history = []
  }

  return apiSuccess({ ...result, inputs, history })
})
