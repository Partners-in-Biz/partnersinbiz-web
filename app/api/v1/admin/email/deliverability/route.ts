/**
 * GET /api/v1/admin/email/deliverability — platform email deliverability snapshot.
 *
 * Aggregates REAL data:
 *   • Per sending-domain SPF / DKIM / DMARC verification state, derived from the
 *     existing `email_domains` collection (Resend-synced dnsRecords[] + status).
 *   • Bounce rate + complaint rate computed from the real `emails` send log
 *     (status / bouncedAt / openedAt + stats.* never trusted blindly — counted
 *     from the actual delivered/bounced/complained events).
 *   • A recent webhook event log — the most recent email docs that carry an
 *     event timestamp (delivered / opened / clicked / bounced / complained).
 *   • The pause-outbound control flag from `admin_email_controls/global`.
 *
 * Admin-only (cookie auth on admin pages).
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import type { EmailDomain, EmailDomainDnsRecord } from '@/lib/email/domains'
import { readEmailControls } from '../controls/store'

export const dynamic = 'force-dynamic'

type AuthState = 'verified' | 'pending' | 'failed' | 'missing'

interface DomainAuthRow {
  id: string
  orgId: string
  name: string
  status: string
  spf: AuthState
  dkim: AuthState
  dmarc: AuthState
  region: string
  lastSyncedAt: string | null
}

interface WebhookEventRow {
  emailId: string
  resendId: string
  orgId: string
  to: string
  subject: string
  event: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed'
  at: string | null
}

/**
 * Classify a single DNS record's verification state. Resend stamps a per-record
 * `status` (e.g. "verified", "pending", "not_started", "failed"). When a record
 * type isn't present at all we return 'missing'.
 */
function recordState(rec: EmailDomainDnsRecord | undefined): AuthState {
  if (!rec) return 'missing'
  const s = (rec.status ?? '').toLowerCase()
  if (s === 'verified') return 'verified'
  if (s === 'failed' || s === 'temporary_failure') return 'failed'
  return 'pending'
}

/**
 * Identify which DNS record corresponds to SPF / DKIM / DMARC. Resend returns a
 * `type` hint on some records ("DKIM", "SPF") and a `record` (TXT/CNAME/MX) plus
 * the hostname `name`. We match defensively across those signals.
 */
function classifyRecords(records: EmailDomainDnsRecord[]): {
  spf: EmailDomainDnsRecord | undefined
  dkim: EmailDomainDnsRecord | undefined
  dmarc: EmailDomainDnsRecord | undefined
} {
  let spf: EmailDomainDnsRecord | undefined
  let dkim: EmailDomainDnsRecord | undefined
  let dmarc: EmailDomainDnsRecord | undefined
  for (const r of records ?? []) {
    const type = (r.type ?? '').toLowerCase()
    const name = (r.name ?? '').toLowerCase()
    const value = (r.value ?? '').toLowerCase()
    if (type.includes('dkim') || name.includes('domainkey') || name.includes('_domainkey')) {
      if (!dkim) dkim = r
      continue
    }
    if (type.includes('dmarc') || name.includes('_dmarc')) {
      if (!dmarc) dmarc = r
      continue
    }
    if (
      type.includes('spf') ||
      value.includes('v=spf1') ||
      value.includes('include:') ||
      (r.record ?? '').toUpperCase() === 'MX'
    ) {
      if (!spf) spf = r
      continue
    }
  }
  // Resend's verified TXT "send" record functions as the SPF authorisation when
  // no explicit v=spf1 record is surfaced — fall back to the first TXT/MX.
  if (!spf) {
    spf = (records ?? []).find(
      (r) => (r.record ?? '').toUpperCase() === 'TXT' || (r.record ?? '').toUpperCase() === 'MX',
    )
  }
  return { spf, dkim, dmarc }
}

function tsToIso(v: unknown): string | null {
  if (!v) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (v as any)?.toDate?.()
  if (d instanceof Date) return d.toISOString()
  if (typeof v === 'string') return v
  return null
}

function tsToMs(v: unknown): number | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (v as any)?.toMillis?.()
  if (typeof d === 'number') return d
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dd = (v as any)?.toDate?.()
  if (dd instanceof Date) return dd.getTime()
  return null
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const windowDays = Math.min(90, Math.max(1, parseInt(searchParams.get('days') ?? '30', 10) || 30))
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000

  // ── Sending domains (SPF/DKIM/DMARC) ──────────────────────────────────────
  const domainSnap = await adminDb.collection('email_domains').get()
  const domains: DomainAuthRow[] = []
  for (const d of domainSnap.docs) {
    const data = { id: d.id, ...d.data() } as EmailDomain
    if (data.deleted) continue
    const { spf, dkim, dmarc } = classifyRecords(data.dnsRecords ?? [])
    // When the whole domain is Resend-verified, treat records without an
    // explicit per-record status as verified (Resend only flags failures).
    const domainVerified = data.status === 'verified'
    const lift = (st: AuthState): AuthState =>
      st === 'pending' && domainVerified ? 'verified' : st
    domains.push({
      id: data.id,
      orgId: data.orgId ?? '',
      name: data.name ?? '',
      status: data.status ?? 'pending',
      spf: lift(recordState(spf)),
      dkim: lift(recordState(dkim)),
      dmarc: recordState(dmarc), // DMARC is operator-managed; never auto-lifted
      region: data.region ?? '',
      lastSyncedAt: tsToIso(data.lastSyncedAt),
    })
  }

  // ── Bounce / complaint rates + recent events from the `emails` send log ────
  // The send log is large; cap the scan to a recent slice ordered by createdAt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emailsQuery: any = adminDb.collection('emails')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let emailDocs: any[] = []
  try {
    const snap = await emailsQuery.orderBy('createdAt', 'desc').limit(4000).get()
    emailDocs = snap.docs
  } catch {
    const snap = await emailsQuery.limit(4000).get()
    emailDocs = snap.docs
  }

  let sent = 0
  let delivered = 0
  let bounced = 0
  let complained = 0
  const events: WebhookEventRow[] = []

  for (const doc of emailDocs) {
    const e = doc.data() ?? {}
    const createdMs = tsToMs(e.createdAt) ?? tsToMs(e.sentAt)
    if (createdMs !== null && createdMs < sinceMs) continue

    const status = (e.status ?? '').toString()
    sent += 1
    if (status === 'delivered' || status === 'opened' || status === 'clicked') delivered += 1
    const isBounce = !!e.bouncedAt || status === 'failed'
    if (isBounce) bounced += 1
    if (e.complainedAt || status === 'complained' || e.unsubscribedAt) {
      // Complaint is a spam report — distinct from a normal unsubscribe. We only
      // count it when the email itself recorded a complaint signal.
      if (e.complainedAt || status === 'complained') complained += 1
    }

    // Build the recent event log: pick the strongest event this doc recorded.
    const eventAt =
      tsToMs(e.bouncedAt) ??
      tsToMs(e.clickedAt) ??
      tsToMs(e.openedAt) ??
      tsToMs(e.complainedAt) ??
      createdMs
    let ev: WebhookEventRow['event'] | null = null
    if (e.complainedAt || status === 'complained') ev = 'complained'
    else if (e.bouncedAt || status === 'failed') ev = e.bouncedAt ? 'bounced' : 'failed'
    else if (e.clickedAt || status === 'clicked') ev = 'clicked'
    else if (e.openedAt || status === 'opened') ev = 'opened'
    else if (status === 'delivered') ev = 'delivered'
    if (ev && events.length < 50) {
      events.push({
        emailId: doc.id,
        resendId: (e.resendId ?? '').toString(),
        orgId: (e.orgId ?? '').toString(),
        to: (e.to ?? '').toString(),
        subject: (e.subject ?? '').toString(),
        event: ev,
        at: eventAt ? new Date(eventAt).toISOString() : null,
      })
    }
  }

  events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

  const bounceRate = sent > 0 ? bounced / sent : 0
  const complaintRate = sent > 0 ? complained / sent : 0

  const controls = await readEmailControls()

  return apiSuccess({
    windowDays,
    domains,
    metrics: {
      sent,
      delivered,
      bounced,
      complained,
      // Gmail/Yahoo thresholds: bounce should stay < 2-4%, complaints < 0.3%.
      bounceRate,
      complaintRate,
      bounceRatePct: Math.round(bounceRate * 10000) / 100,
      complaintRatePct: Math.round(complaintRate * 10000) / 100,
    },
    events: events.slice(0, 50),
    controls,
  })
})
