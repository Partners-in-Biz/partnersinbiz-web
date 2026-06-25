/**
 * GET /api/v1/billing/usage   (client / admin / ai)
 *
 * Portal-facing usage dashboard data. Computes REAL usage for the resolved org
 * against the org's plan limits and emits 80% / 95% threshold indicators.
 *
 * Meters (current vs plan limit):
 *   - emailSends    : `emails` docs with status 'sent' this calendar month (UTC)
 *   - contacts      : total `contacts` docs for the org (lifetime — a contact is
 *                     a stored record, not a monthly event)
 *   - socialPosts   : `social_posts` docs created this calendar month (UTC)
 *   - apiCalls      : `quota_usage` apiCallsPerMonth counter for this month
 *   - storage       : bytes from `uploads` (size) + `social_media` (originalSize)
 *
 * Plan limits come from the live `plans` collection (Plan.limits). Where a plan
 * does not define a limit for a meter we fall back to a sane platform default so
 * the meter still renders a denominator. `-1` = unlimited.
 *
 * Alert emails: when a meter crosses 80% or 95% and an alert for that
 * (org, meter, threshold, month) has not already been sent, a single alert
 * email is dispatched to the org billing email and recorded in `usage_alerts`
 * to guarantee one-shot delivery (idempotent across repeated dashboard loads).
 *
 * EFT-first: overage is NOT auto-charged. The policy is advisory — usage above
 * 100% is flagged and reconciled on the next EFT invoice, never a card.
 *
 * All reads are single-field queries / aggregations — no composite indexes.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email/send'
import type { PlanLimits } from '@/lib/plans/types'

export const dynamic = 'force-dynamic'

const STORAGE_SCAN_CAP = 20000

/** Org ids exempt from usage limits (platform owner). */
const EXEMPT_ORG_IDS = new Set(['pib-platform-owner'])

/**
 * Platform default denominators used only when the org's plan does not define a
 * limit for that meter. Mirrors lib/plans DEFAULT_PLAN_LIMITS + lib/platform
 * quota defaults so a meter always has a denominator.
 */
const FALLBACK_LIMITS = {
  emailsPerMonth: 1000,
  contacts: 1000,
  socialPostsPerMonth: 30,
  apiCallsPerMonth: 10000,
  storageMb: 1024,
} as const

type MeterKey = 'emailSends' | 'contacts' | 'socialPosts' | 'apiCalls' | 'storage'

interface Meter {
  key: MeterKey
  label: string
  unit: string
  used: number
  limit: number // -1 = unlimited
  unlimited: boolean
  percent: number // 0..100+ (0 when unlimited)
  status: 'ok' | 'warning' | 'critical' | 'over'
  resetsMonthly: boolean
  helper: string
}

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

function toNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

function statusFor(percent: number, unlimited: boolean): Meter['status'] {
  if (unlimited) return 'ok'
  if (percent >= 100) return 'over'
  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warning'
  return 'ok'
}

async function loadPlanLimits(orgPlanKey: string): Promise<{ planKey: string; planName: string; limits: Partial<PlanLimits> }> {
  // Plan docs are keyed by their machine `key` field; doc id may differ. Try a
  // where(key) lookup first, then fall back to doc(planKey).
  const byKey = await adminDb.collection('plans').where('key', '==', orgPlanKey).limit(1).get()
  let planDoc = byKey.docs[0]
  if (!planDoc) {
    const direct = await adminDb.collection('plans').doc(orgPlanKey).get()
    if (direct.exists) planDoc = direct as typeof planDoc
  }
  const data = planDoc?.data() as { name?: string; key?: string; limits?: Partial<PlanLimits> } | undefined
  return {
    planKey: data?.key ?? orgPlanKey,
    planName: data?.name ?? orgPlanKey,
    limits: data?.limits ?? {},
  }
}

async function countCollection(field: string, orgId: string, collection: string, extra?: { field: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }): Promise<number> {
  let query: FirebaseFirestore.Query = adminDb.collection(collection).where(field, '==', orgId)
  if (extra) query = query.where(extra.field, extra.op, extra.value)
  const snap = await query.count().get()
  return snap.data().count
}

async function emailSendsThisMonth(orgId: string, since: Date): Promise<number> {
  // status 'sent' + sentAt >= monthStart. sentAt is set on successful send.
  const snap = await adminDb
    .collection('emails')
    .where('orgId', '==', orgId)
    .where('status', '==', 'sent')
    .where('sentAt', '>=', since)
    .count()
    .get()
  return snap.data().count
}

async function apiCallsThisMonth(orgId: string, month: string): Promise<number> {
  const docId = `${orgId}_apiCallsPerMonth_${month}`
  const snap = await adminDb.collection('quota_usage').doc(docId).get()
  return toNumber(snap.data()?.count)
}

async function storageBytes(orgId: string): Promise<number> {
  let bytes = 0
  const uploads = await adminDb.collection('uploads').where('orgId', '==', orgId).limit(STORAGE_SCAN_CAP).get()
  for (const doc of uploads.docs) {
    const d = doc.data()
    if (d.deleted === true) continue
    bytes += toNumber(d.size)
  }
  const social = await adminDb.collection('social_media').where('orgId', '==', orgId).limit(STORAGE_SCAN_CAP).get()
  for (const doc of social.docs) {
    bytes += toNumber(doc.data().originalSize)
  }
  return bytes
}

function buildMeter(
  key: MeterKey,
  label: string,
  unit: string,
  used: number,
  rawLimit: number,
  resetsMonthly: boolean,
  helper: string,
): Meter {
  const unlimited = rawLimit === -1
  const limit = unlimited ? -1 : Math.max(0, rawLimit)
  const percent = unlimited || limit === 0 ? (unlimited ? 0 : (used > 0 ? 100 : 0)) : Math.round((used / limit) * 100)
  return {
    key,
    label,
    unit,
    used,
    limit,
    unlimited,
    percent,
    status: statusFor(percent, unlimited),
    resetsMonthly,
    helper,
  }
}

/**
 * Fire one-shot alert emails for any meter that has newly crossed a threshold
 * this month. Idempotent via the `usage_alerts` collection. Best-effort: a mail
 * failure never breaks the dashboard response.
 */
async function dispatchAlerts(orgId: string, billingEmail: string, orgName: string, month: string, meters: Meter[]): Promise<string[]> {
  if (!billingEmail) return []
  const fired: string[] = []
  for (const meter of meters) {
    if (meter.unlimited) continue
    const thresholds: Array<{ pct: 80 | 95; status: Meter['status'][] }> = [
      { pct: 95, status: ['critical', 'over'] },
      { pct: 80, status: ['warning', 'critical', 'over'] },
    ]
    for (const t of thresholds) {
      if (!t.status.includes(meter.status)) continue
      const alertId = `${orgId}_${meter.key}_${t.pct}_${month}`
      const ref = adminDb.collection('usage_alerts').doc(alertId)
      const existing = await ref.get()
      if (existing.exists) break // already alerted at this (or higher) tier this month
      const ok = await sendUsageAlertEmail(billingEmail, orgName, meter, t.pct)
      await ref.set({
        orgId,
        meter: meter.key,
        threshold: t.pct,
        month,
        used: meter.used,
        limit: meter.limit,
        percent: meter.percent,
        emailedTo: billingEmail,
        sent: ok,
        createdAt: FieldValue.serverTimestamp(),
      })
      if (ok) fired.push(`${meter.key}@${t.pct}`)
      break // only fire the highest-tier alert per meter per load
    }
  }
  return fired
}

async function sendUsageAlertEmail(to: string, orgName: string, meter: Meter, threshold: 80 | 95): Promise<boolean> {
  const heading = threshold >= 95 ? 'Usage almost exhausted' : 'Usage approaching limit'
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 8px">${heading}</h2>
      <p style="margin:0 0 16px;color:#475569">
        ${orgName} has used <strong>${meter.percent}%</strong> of its monthly
        ${meter.label.toLowerCase()} allowance.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
        <tr>
          <td style="padding:8px 0;color:#475569">Used</td>
          <td style="padding:8px 0;text-align:right;font-weight:600">${meter.used.toLocaleString()} ${meter.unit}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#475569;border-top:1px solid #e2e8f0">Plan limit</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #e2e8f0">${meter.limit.toLocaleString()} ${meter.unit}</td>
        </tr>
      </table>
      <p style="margin:0 0 16px;color:#475569">
        Usage above 100% is reconciled on your next EFT invoice — there is no card
        on file and nothing is auto-charged. Review your usage in the portal:
      </p>
      <a href="https://partnersinbiz.online/portal/billing/usage"
         style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
        Open usage dashboard
      </a>
    </div>`.trim()
  const res = await sendEmail({
    to,
    subject: `${heading}: ${meter.label} at ${meter.percent}%`,
    html,
  }).catch(() => ({ success: false }))
  return res.success === true
}

export const GET = withAuth(
  'client',
  withTenant(async (_req: NextRequest, _user, orgId) => {
    const now = new Date()
    const month = monthKey(now)
    const since = monthStart(now)

    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    const org = orgSnap.data() ?? {}
    const orgName = (org.name as string | undefined) ?? orgId
    const billingEmail = (org.billingEmail as string | undefined) ?? ''
    const planKey = (org.plan as string | undefined) ?? 'starter'

    const { planName, limits } = await loadPlanLimits(planKey)

    const [emailSends, contacts, socialPosts, apiCalls, bytes] = await Promise.all([
      emailSendsThisMonth(orgId, since).catch(() => 0),
      countCollection('orgId', orgId, 'contacts').catch(() => 0),
      countCollection('orgId', orgId, 'social_posts', { field: 'createdAt', op: '>=', value: since }).catch(() => 0),
      apiCallsThisMonth(orgId, month).catch(() => 0),
      storageBytes(orgId).catch(() => 0),
    ])

    const exempt = EXEMPT_ORG_IDS.has(orgId)
    const limitOr = (value: number | undefined, fallback: number): number =>
      exempt ? -1 : (typeof value === 'number' ? value : fallback)

    const storageUsedMb = Math.round((bytes / (1024 * 1024)) * 10) / 10

    const meters: Meter[] = [
      buildMeter('emailSends', 'Email sends', 'emails', emailSends, limitOr(limits.emailsPerMonth, FALLBACK_LIMITS.emailsPerMonth), true, 'Emails sent this calendar month.'),
      buildMeter('contacts', 'Contacts', 'contacts', contacts, limitOr(limits.contacts ?? limits.contactsPerMonth, FALLBACK_LIMITS.contacts), false, 'Total contacts stored in your CRM.'),
      buildMeter('socialPosts', 'Social posts', 'posts', socialPosts, limitOr(limits.socialPostsPerMonth, FALLBACK_LIMITS.socialPostsPerMonth), true, 'Social posts created this calendar month.'),
      buildMeter('apiCalls', 'API calls', 'calls', apiCalls, limitOr(limits.apiCallsPerMonth, FALLBACK_LIMITS.apiCallsPerMonth), true, 'Platform API calls this calendar month.'),
      buildMeter('storage', 'Storage', 'MB', storageUsedMb, limitOr(limits.storageMb, FALLBACK_LIMITS.storageMb), false, 'Uploaded files and social media assets.'),
    ]

    const alertsFired = await dispatchAlerts(orgId, billingEmail, orgName, month, meters).catch(() => [] as string[])

    const anyWarning = meters.some((m) => m.status === 'warning' || m.status === 'critical' || m.status === 'over')
    const anyOver = meters.some((m) => m.status === 'over')

    return apiSuccess({
      orgId,
      orgName,
      planKey,
      planName,
      month,
      billingEmail,
      meters,
      thresholds: { warning: 80, critical: 95 },
      overagePolicy:
        'Partners in Biz is EFT-first — there is no card on file. Usage above 100% is not auto-charged; ' +
        'it is flagged here and reconciled on your next EFT invoice. Monthly meters reset on the 1st (UTC).',
      summary: { anyWarning, anyOver, alertsFired },
      generatedAt: now.toISOString(),
    })
  }),
)
