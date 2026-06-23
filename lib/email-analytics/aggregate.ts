// lib/email-analytics/aggregate.ts
//
// Email analytics aggregation layer. Pulls from the `emails` collection plus
// the pre-aggregated `broadcasts.stats`, `campaigns.stats`, and
// `sequence_enrollments` to produce dashboard-ready overviews, timeseries,
// per-broadcast/per-sequence detail, and per-contact engagement.

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Email } from '@/lib/email/types'
import type { Broadcast, BroadcastSendStats } from '@/lib/broadcasts/types'
import type { Campaign } from '@/lib/campaigns/types'
import type {
  Sequence,
  SequenceEnrollment,
  EnrollmentStatus,
} from '@/lib/sequences/types'
import type { Contact } from '@/lib/crm/types'
import { dayOfWeekInTimezone, hourInTimezone } from '@/lib/email/send-time'

// ── Types ───────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date // inclusive
  to: Date // exclusive
}

export interface OrgEmailOverview {
  range: { from: string; to: string }
  totals: {
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
    unsubscribed: number
    failed: number
  }
  rates: {
    deliveryRate: number
    openRate: number
    clickRate: number
    ctrOnOpens: number
    bounceRate: number
    unsubRate: number
  }
  bySource: {
    broadcast: { sent: number; opened: number; clicked: number }
    campaign: { sent: number; opened: number; clicked: number }
    sequence: { sent: number; opened: number; clicked: number }
    oneOff: { sent: number; opened: number; clicked: number }
  }
  topBroadcasts: Array<{
    id: string
    name: string
    sent: number
    opened: number
    clicked: number
    openRate: number
    clickRate: number
  }>
  topCampaigns: Array<{
    id: string
    name: string
    sent: number
    opened: number
    clicked: number
    openRate: number
    clickRate: number
  }>
  worstBounces: Array<{ id: string; name: string; bounced: number; bounceRate: number }>
}

export interface EngagementTimeseries {
  range: { from: string; to: string }
  bucket: 'day' | 'week'
  series: Array<{
    date: string
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
  }>
}

export interface BroadcastDetailedStats {
  broadcastId: string
  stats: BroadcastSendStats
  rates: {
    deliveryRate: number
    openRate: number
    clickRate: number
    bounceRate: number
    unsubRate: number
  }
  timeline: Array<{ date: string; sent: number; opened: number; clicked: number }>
  topClicks: Array<{ url: string; clicks: number }>
  topDomains: Array<{ domain: string; sent: number; opened: number; openRate: number }>
  unsubReasons: Record<string, number>
}

export interface CampaignContactActivityRow {
  contactId: string
  email: string
  name: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  lastEngagedAt: string | null
  status: 'opened' | 'clicked' | 'bounced' | 'delivered' | 'sent' | 'none'
}

export interface CampaignDetailedStats {
  campaignId: string
  name: string
  stats: {
    audienceSize: number
    enrolled: number
    sent: number
    delivered: number
    opened: number // UNIQUE opens (distinct contacts who opened)
    clicked: number // UNIQUE clicks (distinct contacts who clicked)
    hardBounced: number
    softBounced: number
    bounced: number // hard + soft
    unsubscribed: number
  }
  rates: {
    deliveryRate: number
    openRate: number
    clickRate: number
    ctrOnOpens: number
    bounceRate: number
    hardBounceRate: number
    unsubRate: number
  }
  timeline: Array<{ date: string; sent: number; opened: number; clicked: number }>
  topClicks: Array<{ url: string; clicks: number }>
  topDomains: Array<{ domain: string; sent: number; opened: number; openRate: number }>
  contactActivity: CampaignContactActivityRow[]
}

export interface SequenceDetailedStats {
  sequenceId: string
  sequence: {
    id: string
    name: string
    description: string
    status: Sequence['status']
    stepsCount: number
  }
  totalEnrollments: number
  byStatus: Record<string, number>
  stepFunnel: Array<{
    stepNumber: number
    subject: string
    sent: number
    opened: number
    clicked: number
    dropOffPercent: number
  }>
  averageCompletionDays: number
  insights: {
    completionRate: number
    openRate: number
    clickRate: number
    weakestStepNumber: number | null
    nextActions: string[]
  }
}

export interface ContactEngagement {
  contactId: string
  email: string
  name: string
  score: number
  sent: number
  opened: number
  clicked: number
  lastEngagedAt: string | null
  lastSentAt: string | null
  status:
    | 'highly-engaged'
    | 'engaged'
    | 'cooling'
    | 'dormant'
    | 'unsubscribed'
    | 'bounced'
}

export interface OrgComparisonRow {
  orgId: string
  orgName: string
  sent: number
  openRate: number
  clickRate: number
  bounceRate: number
}

// ── Cohort retention ────────────────────────────────────────────────────────

export interface CohortRow {
  cohortStart: string // ISO date (Monday of the week)
  cohortSize: number // contacts created in this week
  weekIndex: number[] // [0, 1, 2, 3, ...] — weeks since signup
  // For each weekIndex, what % of cohort still engaged (had an open/click in that week)?
  retentionPercent: number[] // parallel array to weekIndex
}

export interface CohortAnalysis {
  range: { from: string; to: string }
  weeksToShow: number
  cohorts: CohortRow[]
}

// ── Click heatmap (per-broadcast) ───────────────────────────────────────────

export interface LinkClickStat {
  url: string
  clicks: number
  uniqueClicks: number // distinct contacts
  percentOfTotalClicks: number // share of total clicks in this broadcast
  positionInEmail?: number // 1-based index of this link in the email body
}

export interface BroadcastHeatmap {
  broadcastId: string
  totalClicks: number
  linkStats: LinkClickStat[] // sorted by clicks desc
}

// ── Send-time matrix ────────────────────────────────────────────────────────

export interface SendTimeCell {
  sent: number
  opened: number
  openRate: number
}

export interface SendTimeMatrix {
  // 7 days x 24 hours = 168 cells. Each cell: { sent, opened, openRate }
  // dayOfWeek: 0=Sun..6=Sat. hour: 0-23. Stored in the ORG's timezone.
  cells: SendTimeCell[][] // [dayOfWeek][hour]
  bestDay: number
  bestHour: number
  worstDay: number
  worstHour: number
  totalSamples: number
  timezone: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MAX_EMAILS_PER_QUERY = 50_000
const CHUNK_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

type ShortenedLinkRow = {
  id: string
  shortCode?: string
  shortUrl?: string
  originalUrl?: string
  clickCount?: number
}

type LeaderboardOrgRow = {
  id: string
  name?: string
  deleted?: boolean
}

function safeRate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

function rangeToMillis(range: DateRange): { fromMs: number; toMs: number } {
  return { fromMs: range.from.getTime(), toMs: range.to.getTime() }
}

function tsToMs(ts: Timestamp | null | undefined): number | null {
  if (!ts) return null
  try {
    return ts.toMillis()
  } catch {
    return null
  }
}

function toIso(d: Date): string {
  return d.toISOString()
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  // YYYY-MM-DD in UTC for stable buckets across timezones.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function weekKey(ms: number): string {
  // ISO week (Mon=1..Sun=7). Returns "GGGG-Www".
  const d = new Date(ms)
  // Shift to Thursday of the current week to find ISO week year correctly.
  const day = (d.getUTCDay() + 6) % 7 // 0..6, Monday=0
  const thursday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3),
  )
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - yearStart.getTime()) / DAY_MS - 3 + ((yearStart.getUTCDay() + 6) % 7)) /
        7,
    )
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Fetch all emails for an org within a date range. Chunks the query into
 * 30-day windows to stay well under the 50k cap for very long ranges.
 */
async function fetchEmailsInRange(orgId: string, range: DateRange): Promise<Email[]> {
  const { fromMs, toMs } = rangeToMillis(range)
  if (toMs <= fromMs) return []

  const windows: Array<{ from: Date; to: Date }> = []
  let cursor = fromMs
  while (cursor < toMs) {
    const next = Math.min(cursor + CHUNK_DAYS * DAY_MS, toMs)
    windows.push({ from: new Date(cursor), to: new Date(next) })
    cursor = next
  }

  const all: Email[] = []
  for (const w of windows) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = await (adminDb.collection('emails'))
        .where('orgId', '==', orgId)
        .where('sentAt', '>=', Timestamp.fromDate(w.from))
        .where('sentAt', '<', Timestamp.fromDate(w.to))
        .limit(MAX_EMAILS_PER_QUERY)
        .get()

      for (const doc of snap.docs) {
        const data = doc.data() as Email
        if (data.deleted === true) continue
        all.push({ ...data, id: doc.id })
      }
    } catch {
      // Some deployed/client workspaces do not have the composite
      // `emails(orgId, sentAt)` index yet. Fall back to a tenant-only read and
      // filter by sentAt in memory so analytics still works.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = await (adminDb.collection('emails'))
        .where('orgId', '==', orgId)
        .limit(MAX_EMAILS_PER_QUERY)
        .get()

      for (const doc of snap.docs) {
        const data = doc.data() as Email
        if (data.deleted === true) continue
        const sentMs = tsToMs(data.sentAt)
        if (sentMs === null || sentMs < fromMs || sentMs >= toMs) continue
        all.push({ ...data, id: doc.id })
      }
      break
    }
  }
  return all
}

function classifySource(e: Email): 'broadcast' | 'campaign' | 'sequence' | 'oneOff' {
  if (e.broadcastId) return 'broadcast'
  if (e.campaignId) return 'campaign'
  if (e.sequenceId) return 'sequence'
  return 'oneOff'
}

function emailIsDelivered(e: Email): boolean {
  // No webhook 'delivered' status in this codebase — treat any of
  // sent/opened/clicked as delivered (i.e. not failed and not bounced).
  return (
    (e.status === 'sent' || e.status === 'opened' || e.status === 'clicked') &&
    !e.bouncedAt
  )
}

function emailIsBounced(e: Email): boolean {
  return !!e.bouncedAt
}

function emailIsFailed(e: Email): boolean {
  return e.status === 'failed'
}

function emailIsOpened(e: Email): boolean {
  return !!e.openedAt || e.status === 'opened' || e.status === 'clicked'
}

function emailIsClicked(e: Email): boolean {
  return !!e.clickedAt || e.status === 'clicked'
}

// ── Overview ────────────────────────────────────────────────────────────────

export async function getOrgEmailOverview(
  orgId: string,
  range: DateRange,
): Promise<OrgEmailOverview> {
  const emails = await fetchEmailsInRange(orgId, range)
  const { fromMs, toMs } = rangeToMillis(range)

  let sent = 0
  let delivered = 0
  let opened = 0
  let clicked = 0
  let bounced = 0
  let failed = 0
  // unsubscribed is derived from contacts.unsubscribedAt below

  const bySource = {
    broadcast: { sent: 0, opened: 0, clicked: 0 },
    campaign: { sent: 0, opened: 0, clicked: 0 },
    sequence: { sent: 0, opened: 0, clicked: 0 },
    oneOff: { sent: 0, opened: 0, clicked: 0 },
  }

  for (const e of emails) {
    sent += 1
    if (emailIsDelivered(e)) delivered += 1
    if (emailIsOpened(e)) opened += 1
    if (emailIsClicked(e)) clicked += 1
    if (emailIsBounced(e)) bounced += 1
    if (emailIsFailed(e)) failed += 1

    const src = classifySource(e)
    bySource[src].sent += 1
    if (emailIsOpened(e)) bySource[src].opened += 1
    if (emailIsClicked(e)) bySource[src].clicked += 1
  }

  // Unsubscribes in the window — pull contacts unsubscribed within the range.
  let unsubscribed = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubSnap = await (adminDb.collection('contacts'))
      .where('orgId', '==', orgId)
      .where('unsubscribedAt', '>=', Timestamp.fromDate(range.from))
      .where('unsubscribedAt', '<', Timestamp.fromDate(range.to))
      .get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unsubscribed = unsubSnap.docs.filter((d) => d.data().deleted !== true).length
  } catch {
    // Missing composite index on contacts(orgId, unsubscribedAt) — fall back
    // to scanning all contacts in the org. Cheap for small orgs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSnap = await (adminDb.collection('contacts'))
      .where('orgId', '==', orgId)
      .get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unsubscribed = allSnap.docs.filter((d) => {
      const data = d.data() as Contact
      if (data.deleted === true) return false
      const ms = tsToMs(data.unsubscribedAt)
      return ms !== null && ms >= fromMs && ms < toMs
    }).length
  }

  // Top broadcasts/campaigns — read pre-aggregated stats directly. We pull all
  // broadcasts/campaigns for the org and filter to those active in the range.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcastsSnap = await (adminDb.collection('broadcasts'))
    .where('orgId', '==', orgId)
    .get()
  const broadcastsInRange: Broadcast[] = broadcastsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() } as Broadcast))
    .filter((b: Broadcast) => {
      if (b.deleted === true) return false
      const startMs = tsToMs(b.sendStartedAt) ?? tsToMs(b.scheduledFor) ?? tsToMs(b.createdAt)
      if (startMs === null) return false
      return startMs >= fromMs && startMs < toMs
    })

  const topBroadcasts = broadcastsInRange
    .map((b: Broadcast) => {
      const s = b.stats ?? {
        sent: 0,
        opened: 0,
        clicked: 0,
        delivered: 0,
        bounced: 0,
        unsubscribed: 0,
        failed: 0,
        audienceSize: 0,
        queued: 0,
      }
      const denom = s.delivered || s.sent
      return {
        id: b.id,
        name: b.name,
        sent: s.sent,
        opened: s.opened,
        clicked: s.clicked,
        openRate: safeRate(s.opened, denom),
        clickRate: safeRate(s.clicked, denom),
      }
    })
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 5)

  const worstBounces = broadcastsInRange
    .map((b: Broadcast) => {
      const s = b.stats ?? { sent: 0, bounced: 0 }
      return {
        id: b.id,
        name: b.name,
        bounced: s.bounced ?? 0,
        bounceRate: safeRate(s.bounced ?? 0, s.sent ?? 0),
      }
    })
    .filter((b) => b.bounced > 0)
    .sort((a, b) => b.bounceRate - a.bounceRate)
    .slice(0, 5)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaignsSnap = await (adminDb.collection('campaigns'))
    .where('orgId', '==', orgId)
    .get()
  const topCampaigns = campaignsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() } as Campaign))
    .filter((c: Campaign) => {
      if (c.deleted === true) return false
      const startMs = tsToMs(c.startAt) ?? tsToMs(c.createdAt)
      if (startMs === null) return false
      return startMs >= fromMs && startMs < toMs
    })
    .map((c: Campaign) => {
      const s = c.stats ?? {
        enrolled: 0,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0,
      }
      const denom = s.delivered || s.sent
      return {
        id: c.id,
        name: c.name,
        sent: s.sent,
        opened: s.opened,
        clicked: s.clicked,
        openRate: safeRate(s.opened, denom),
        clickRate: safeRate(s.clicked, denom),
      }
    })
    .sort((a: { sent: number }, b: { sent: number }) => b.sent - a.sent)
    .slice(0, 5)

  return {
    range: { from: toIso(range.from), to: toIso(range.to) },
    totals: { sent, delivered, opened, clicked, bounced, unsubscribed, failed },
    rates: {
      deliveryRate: safeRate(delivered, sent),
      openRate: safeRate(opened, delivered),
      clickRate: safeRate(clicked, delivered),
      ctrOnOpens: safeRate(clicked, opened),
      bounceRate: safeRate(bounced, sent),
      unsubRate: safeRate(unsubscribed, delivered),
    },
    bySource,
    topBroadcasts,
    topCampaigns,
    worstBounces,
  }
}

// ── Timeseries ──────────────────────────────────────────────────────────────

export async function getEngagementTimeseries(
  orgId: string,
  range: DateRange,
  bucket: 'day' | 'week',
): Promise<EngagementTimeseries> {
  const emails = await fetchEmailsInRange(orgId, range)
  const bucketize = bucket === 'week' ? weekKey : dayKey

  const map = new Map<
    string,
    { sent: number; delivered: number; opened: number; clicked: number; bounced: number }
  >()

  // Pre-fill empty buckets so charts show gaps as zeros, not missing points.
  const { fromMs, toMs } = rangeToMillis(range)
  if (bucket === 'day') {
    for (let t = fromMs; t < toMs; t += DAY_MS) {
      map.set(dayKey(t), { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 })
    }
  } else {
    // Weekly: step day-by-day and bucket so we get all weeks covered.
    for (let t = fromMs; t < toMs; t += DAY_MS) {
      const k = weekKey(t)
      if (!map.has(k)) {
        map.set(k, { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 })
      }
    }
  }

  for (const e of emails) {
    const ms = tsToMs(e.sentAt)
    if (ms === null) continue
    const key = bucketize(ms)
    const slot = map.get(key) ?? {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
    }
    slot.sent += 1
    if (emailIsDelivered(e)) slot.delivered += 1
    if (emailIsOpened(e)) slot.opened += 1
    if (emailIsClicked(e)) slot.clicked += 1
    if (emailIsBounced(e)) slot.bounced += 1
    map.set(key, slot)
  }

  const series = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

  return {
    range: { from: toIso(range.from), to: toIso(range.to) },
    bucket,
    series,
  }
}

// ── Broadcast detail ────────────────────────────────────────────────────────

export async function getBroadcastStats(
  orgId: string,
  broadcastId: string,
): Promise<BroadcastDetailedStats> {
  const bSnap = await adminDb.collection('broadcasts').doc(broadcastId).get()
  if (!bSnap.exists || bSnap.data()?.deleted === true || bSnap.data()?.orgId !== orgId) {
    throw new Error('Broadcast not found')
  }
  const broadcast = { id: bSnap.id, ...bSnap.data() } as Broadcast
  const stats = broadcast.stats ?? {
    audienceSize: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    failed: 0,
  }

  // Per-email pull, scoped to this broadcast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emailsSnap = await (adminDb.collection('emails'))
    .where('orgId', '==', orgId)
    .where('broadcastId', '==', broadcastId)
    .limit(MAX_EMAILS_PER_QUERY)
    .get()
  const emails: Email[] = emailsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() } as Email))
     
    .filter((e: Email) => e.deleted !== true)

  // Timeline by day
  const timelineMap = new Map<string, { sent: number; opened: number; clicked: number }>()
  // Domain stats
  const domainMap = new Map<string, { sent: number; opened: number }>()

  for (const e of emails) {
    const ms = tsToMs(e.sentAt)
    if (ms !== null) {
      const k = dayKey(ms)
      const slot = timelineMap.get(k) ?? { sent: 0, opened: 0, clicked: 0 }
      slot.sent += 1
      if (emailIsOpened(e)) slot.opened += 1
      if (emailIsClicked(e)) slot.clicked += 1
      timelineMap.set(k, slot)
    }
    const at = (e.to ?? '').split('@')[1]?.toLowerCase().trim()
    if (at) {
      const dslot = domainMap.get(at) ?? { sent: 0, opened: 0 }
      dslot.sent += 1
      if (emailIsOpened(e)) dslot.opened += 1
      domainMap.set(at, dslot)
    }
  }

  const timeline = Array.from(timelineMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

  const topDomains = Array.from(domainMap.entries())
    .map(([domain, v]) => ({
      domain,
      sent: v.sent,
      opened: v.opened,
      openRate: safeRate(v.opened, v.sent),
    }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10)

  // Top clicks — pull from `link_clicks` collection via shortened links
  // owned by this org. We can't filter by broadcastId directly (links don't
  // carry it), so we settle for: links the broadcast's HTML body references
  // (cheap) AND fall back to overall org top URLs in the same time window.
  const topClicks: Array<{ url: string; clicks: number }> = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linksSnap = await (adminDb.collection('shortened_links'))
      .where('orgId', '==', orgId)
      .get()
    const bodyHtml = broadcast.content?.bodyHtml ?? ''
     
    const linksReferenced = linksSnap.docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d) => ({ id: d.id, ...d.data() }) as ShortenedLinkRow)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((l) => Boolean((l.shortCode && bodyHtml.includes(l.shortCode)) || (l.shortUrl && bodyHtml.includes(l.shortUrl))))
    for (const l of linksReferenced) {
      topClicks.push({ url: l.originalUrl ?? '', clicks: l.clickCount ?? 0 })
    }
  } catch {
    // shortened_links collection may not exist or be empty — empty list is fine.
  }
  topClicks.sort((a, b) => b.clicks - a.clicks)

  const denom = stats.delivered || stats.sent
  return {
    broadcastId,
    stats,
    rates: {
      deliveryRate: safeRate(stats.delivered, stats.sent),
      openRate: safeRate(stats.opened, denom),
      clickRate: safeRate(stats.clicked, denom),
      bounceRate: safeRate(stats.bounced, stats.sent),
      unsubRate: safeRate(stats.unsubscribed, denom),
    },
    timeline,
    topClicks: topClicks.slice(0, 10),
    topDomains,
    unsubReasons: {},
  }
}

// ── Campaign detail ─────────────────────────────────────────────────────────

/**
 * Per-campaign analytics. Aggregates the `emails` collection filtered by
 * `campaignId == id`, mirroring getBroadcastStats but computing UNIQUE opens /
 * clicks (distinct contacts) and splitting hard vs soft bounces.
 *
 * Bounce classification (matches the webhook writes):
 *   - hard bounce: email.bouncedAt is set (permanent or escalated soft bounce)
 *   - soft bounce: email.status === 'failed' AND no bouncedAt
 */
export async function getCampaignStats(
  orgId: string,
  campaignId: string,
): Promise<CampaignDetailedStats> {
  const cSnap = await adminDb.collection('campaigns').doc(campaignId).get()
  if (!cSnap.exists || cSnap.data()?.deleted === true || cSnap.data()?.orgId !== orgId) {
    throw new Error('Campaign not found')
  }
  const campaign = { id: cSnap.id, ...cSnap.data() } as Campaign
  const enrolled = campaign.stats?.enrolled ?? 0

  // Per-email pull, scoped to this campaign.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emailsSnap = await (adminDb.collection('emails'))
    .where('orgId', '==', orgId)
    .where('campaignId', '==', campaignId)
    .limit(MAX_EMAILS_PER_QUERY)
    .get()
  const emails: Email[] = emailsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() } as Email))
    .filter((e: Email) => e.deleted !== true)

  // Totals
  let sent = 0
  let delivered = 0
  let hardBounced = 0
  let softBounced = 0

  // Unique opens / clicks tracked by distinct contact (fall back to email id
  // when a contact isn't linked so one-off rows still count once).
  const openedContacts = new Set<string>()
  const clickedContacts = new Set<string>()

  // Timeline by day + domain rollup.
  const timelineMap = new Map<string, { sent: number; opened: number; clicked: number }>()
  const domainMap = new Map<string, { sent: number; opened: number }>()

  // Per-contact activity.
  type ContactAgg = {
    email: string
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
    lastEngagedMs: number | null
  }
  const contactAgg = new Map<string, ContactAgg>()

  for (const e of emails) {
    sent += 1
    const isHard = !!e.bouncedAt
    const isSoft = !isHard && e.status === 'failed'
    if (isHard) hardBounced += 1
    if (isSoft) softBounced += 1
    if (emailIsDelivered(e)) delivered += 1

    const key = e.contactId || `email:${e.id}`
    if (emailIsOpened(e)) openedContacts.add(key)
    if (emailIsClicked(e)) clickedContacts.add(key)

    const ms = tsToMs(e.sentAt)
    if (ms !== null) {
      const dk = dayKey(ms)
      const slot = timelineMap.get(dk) ?? { sent: 0, opened: 0, clicked: 0 }
      slot.sent += 1
      if (emailIsOpened(e)) slot.opened += 1
      if (emailIsClicked(e)) slot.clicked += 1
      timelineMap.set(dk, slot)
    }

    const at = (e.to ?? '').split('@')[1]?.toLowerCase().trim()
    if (at) {
      const dslot = domainMap.get(at) ?? { sent: 0, opened: 0 }
      dslot.sent += 1
      if (emailIsOpened(e)) dslot.opened += 1
      domainMap.set(at, dslot)
    }

    // Per-contact activity (skip rows with no contact link).
    if (e.contactId) {
      const ca = contactAgg.get(e.contactId) ?? {
        email: e.to ?? '',
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        lastEngagedMs: null,
      }
      ca.email = ca.email || (e.to ?? '')
      ca.sent += 1
      if (emailIsDelivered(e)) ca.delivered += 1
      if (emailIsOpened(e)) {
        ca.opened += 1
        const ems = tsToMs(e.openedAt) ?? tsToMs(e.clickedAt) ?? ms
        if (ems !== null) ca.lastEngagedMs = Math.max(ca.lastEngagedMs ?? 0, ems)
      }
      if (emailIsClicked(e)) {
        ca.clicked += 1
        const ems = tsToMs(e.clickedAt) ?? ms
        if (ems !== null) ca.lastEngagedMs = Math.max(ca.lastEngagedMs ?? 0, ems)
      }
      if (isHard || isSoft) ca.bounced += 1
      contactAgg.set(e.contactId, ca)
    }
  }

  const opened = openedContacts.size
  const clicked = clickedContacts.size
  const bounced = hardBounced + softBounced

  // Unsubscribes attributed to this campaign — count contacts on the campaign
  // audience that unsubscribed after enrollment. We approximate using the
  // pre-aggregated campaign.stats.unsubscribed (bumped by the webhook), which
  // is the source of truth the campaign doc carries.
  const unsubscribed = campaign.stats?.unsubscribed ?? 0

  const timeline = Array.from(timelineMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

  const topDomains = Array.from(domainMap.entries())
    .map(([domain, v]) => ({
      domain,
      sent: v.sent,
      opened: v.opened,
      openRate: safeRate(v.opened, v.sent),
    }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10)

  // Top clicks — same approach as broadcasts: shortened links whose code
  // appears in the campaign's sequence step bodies. Campaigns don't carry a
  // single bodyHtml, so we match links against ALL org links and rank by
  // clickCount (best-effort; campaigns route engagement through sequences).
  const topClicks: Array<{ url: string; clicks: number }> = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linksSnap = await (adminDb.collection('shortened_links'))
      .where('orgId', '==', orgId)
      .where('campaignId', '==', campaignId)
      .get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of linksSnap.docs) {
      const l = d.data()
      topClicks.push({ url: (l.originalUrl as string) ?? '', clicks: (l.clickCount as number) ?? 0 })
    }
  } catch {
    // shortened_links may lack a campaignId index — empty list is fine.
  }
  topClicks.sort((a, b) => b.clicks - a.clicks)

  // Contact activity rows — newest engagement first.
  const contactActivity: CampaignContactActivityRow[] = Array.from(contactAgg.entries())
    .map(([contactId, ca]) => {
      let status: CampaignContactActivityRow['status'] = 'none'
      if (ca.clicked > 0) status = 'clicked'
      else if (ca.opened > 0) status = 'opened'
      else if (ca.bounced > 0) status = 'bounced'
      else if (ca.delivered > 0) status = 'delivered'
      else if (ca.sent > 0) status = 'sent'
      return {
        contactId,
        email: ca.email,
        name: '',
        sent: ca.sent,
        delivered: ca.delivered,
        opened: ca.opened,
        clicked: ca.clicked,
        bounced: ca.bounced,
        lastEngagedAt: ca.lastEngagedMs !== null ? new Date(ca.lastEngagedMs).toISOString() : null,
        status,
      }
    })
    .sort((a, b) => {
      const at = a.lastEngagedAt ? Date.parse(a.lastEngagedAt) : 0
      const bt = b.lastEngagedAt ? Date.parse(b.lastEngagedAt) : 0
      if (bt !== at) return bt - at
      return b.sent - a.sent
    })

  // Enrich contact names in one batched pass (cap to keep reads bounded).
  const NAME_LIMIT = 500
  const idsToName = contactActivity.slice(0, NAME_LIMIT).map((r) => r.contactId)
  for (let i = 0; i < idsToName.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = idsToName.slice(i, i + FIRESTORE_IN_LIMIT)
    if (chunk.length === 0) continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = await (adminDb.collection('contacts'))
        .where('orgId', '==', orgId)
        .where('__name__', 'in', chunk)
        .get()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nameById = new Map<string, string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of snap.docs) {
        const c = d.data() as Contact
        nameById.set(d.id, c.name ?? '')
      }
      for (const row of contactActivity) {
        if (nameById.has(row.contactId)) row.name = nameById.get(row.contactId) ?? ''
      }
    } catch {
      // __name__ in queries can fail on some deployments — leave names blank.
    }
  }

  const audienceSize = Math.max(enrolled, contactAgg.size)
  const denom = delivered || sent

  return {
    campaignId,
    name: campaign.name ?? 'Untitled campaign',
    stats: {
      audienceSize,
      enrolled,
      sent,
      delivered,
      opened,
      clicked,
      hardBounced,
      softBounced,
      bounced,
      unsubscribed,
    },
    rates: {
      deliveryRate: safeRate(delivered, sent),
      openRate: safeRate(opened, denom),
      clickRate: safeRate(clicked, denom),
      ctrOnOpens: safeRate(clicked, opened),
      bounceRate: safeRate(bounced, sent),
      hardBounceRate: safeRate(hardBounced, sent),
      unsubRate: safeRate(unsubscribed, denom),
    },
    timeline,
    topClicks: topClicks.slice(0, 10),
    topDomains,
    contactActivity,
  }
}

// ── Sequence detail ─────────────────────────────────────────────────────────

export async function getSequenceStats(
  orgId: string,
  sequenceId: string,
): Promise<SequenceDetailedStats> {
  const sSnap = await adminDb.collection('sequences').doc(sequenceId).get()
  if (!sSnap.exists || sSnap.data()?.deleted === true || sSnap.data()?.orgId !== orgId) {
    throw new Error('Sequence not found')
  }
  const sequence = { id: sSnap.id, ...sSnap.data() } as Sequence

  // Enrollments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrollSnap = await (adminDb.collection('sequence_enrollments'))
    .where('orgId', '==', orgId)
    .where('sequenceId', '==', sequenceId)
    .get()
  const enrollments: SequenceEnrollment[] = enrollSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() } as SequenceEnrollment))
     
    .filter((e: SequenceEnrollment) => e.deleted !== true)

  const byStatus: Record<EnrollmentStatus | string, number> = {
    active: 0,
    paused: 0,
    completed: 0,
    exited: 0,
  }
  let completionDaysSum = 0
  let completionCount = 0
  for (const e of enrollments) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1
    if (e.status === 'completed') {
      const start = tsToMs(e.enrolledAt)
      const end = tsToMs(e.completedAt ?? null)
      if (start !== null && end !== null && end > start) {
        completionDaysSum += (end - start) / DAY_MS
        completionCount += 1
      }
    }
  }

  // Per-step email aggregates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emailsSnap = await (adminDb.collection('emails'))
    .where('orgId', '==', orgId)
    .where('sequenceId', '==', sequenceId)
    .limit(MAX_EMAILS_PER_QUERY)
    .get()
  const stepAgg = new Map<number, { sent: number; opened: number; clicked: number }>()
   
  for (const doc of emailsSnap.docs) {
    const e = { id: doc.id, ...doc.data() } as Email
    if (e.deleted === true) continue
    const step = typeof e.sequenceStep === 'number' ? e.sequenceStep : -1
    if (step < 0) continue
    const slot = stepAgg.get(step) ?? { sent: 0, opened: 0, clicked: 0 }
    slot.sent += 1
    if (emailIsOpened(e)) slot.opened += 1
    if (emailIsClicked(e)) slot.clicked += 1
    stepAgg.set(step, slot)
  }

  const steps = Array.isArray(sequence.steps) ? sequence.steps : []
  const totalEnrollments = enrollments.length
  const stepFunnel = steps.map((s, idx) => {
    const agg = stepAgg.get(idx) ?? { sent: 0, opened: 0, clicked: 0 }
    const dropOffPercent =
      totalEnrollments > 0
        ? Math.round((1 - agg.sent / totalEnrollments) * 10_000) / 100
        : 0
    return {
      stepNumber: s.stepNumber ?? idx,
      subject: s.subject ?? '',
      sent: agg.sent,
      opened: agg.opened,
      clicked: agg.clicked,
      dropOffPercent,
    }
  })
  const totals = stepFunnel.reduce(
    (acc, step) => ({
      sent: acc.sent + step.sent,
      opened: acc.opened + step.opened,
      clicked: acc.clicked + step.clicked,
    }),
    { sent: 0, opened: 0, clicked: 0 },
  )
  const weakestStep = stepFunnel.reduce<(typeof stepFunnel)[number] | null>((weakest, step) => {
    if (!weakest) return step
    return step.dropOffPercent > weakest.dropOffPercent ? step : weakest
  }, null)
  const completionRate = safeRate(byStatus.completed ?? 0, totalEnrollments)
  const openRate = safeRate(totals.opened, totals.sent)
  const clickRate = safeRate(totals.clicked, totals.sent)
  const nextActions: string[] = []

  if (steps.length === 0) {
    nextActions.push('Add at least one sequence step before routing captured contacts into this journey.')
  }
  if (totalEnrollments === 0) {
    nextActions.push('Connect this sequence to capture sources or automations so new contacts enter the journey automatically.')
  }
  if (weakestStep && weakestStep.dropOffPercent >= 25) {
    nextActions.push(`Review Step ${weakestStep.stepNumber} subject, offer, and call to action because it has the largest drop-off.`)
  }
  if (totals.sent > 0 && openRate < 0.25) {
    nextActions.push('Test a stronger subject line and sender framing because the open rate is below 25%.')
  }
  if (totals.sent > 0 && clickRate < 0.05) {
    nextActions.push('Strengthen the call to action and link placement because the click rate is below 5%.')
  }
  if (nextActions.length === 0) {
    nextActions.push('Keep monitoring this sequence and compare the next batch against current completion, open, and click rates.')
  }

  return {
    sequenceId,
    sequence: {
      id: sequenceId,
      name: sequence.name ?? 'Untitled sequence',
      description: sequence.description ?? '',
      status: sequence.status,
      stepsCount: steps.length,
    },
    totalEnrollments,
    byStatus,
    stepFunnel,
    averageCompletionDays:
      completionCount > 0
        ? Math.round((completionDaysSum / completionCount) * 100) / 100
        : 0,
    insights: {
      completionRate,
      openRate,
      clickRate,
      weakestStepNumber: weakestStep ? weakestStep.stepNumber : null,
      nextActions,
    },
  }
}

// ── Contact engagement ──────────────────────────────────────────────────────

export async function getContactEngagement(
  orgId: string,
  opts?: { limit?: number; status?: ContactEngagement['status'] },
): Promise<ContactEngagement[]> {
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 100))

  // Pull contacts for the org (capped).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contactsSnap = await (adminDb.collection('contacts'))
    .where('orgId', '==', orgId)
    .limit(5000)
    .get()
  const contacts: Contact[] = contactsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() } as Contact))
    .filter((c: Contact) => c.deleted !== true)

  if (contacts.length === 0) return []

  // Pull emails for the org over the last 180 days (the engagement window).
  const to = new Date()
  const from = new Date(to.getTime() - 180 * DAY_MS)
  const emails = await fetchEmailsInRange(orgId, { from, to })

  const perContact = new Map<
    string,
    {
      sent: number
      opened: number
      clicked: number
      bounced: number
      lastEngagedMs: number | null
      lastSentMs: number | null
    }
  >()
  for (const e of emails) {
    if (!e.contactId) continue
    const slot = perContact.get(e.contactId) ?? {
      sent: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      lastEngagedMs: null,
      lastSentMs: null,
    }
    slot.sent += 1
    const sentMs = tsToMs(e.sentAt)
    if (sentMs !== null) {
      slot.lastSentMs = Math.max(slot.lastSentMs ?? 0, sentMs)
    }
    if (emailIsOpened(e)) {
      slot.opened += 1
      const ems = tsToMs(e.openedAt) ?? tsToMs(e.clickedAt) ?? sentMs
      if (ems !== null) slot.lastEngagedMs = Math.max(slot.lastEngagedMs ?? 0, ems)
    }
    if (emailIsClicked(e)) {
      slot.clicked += 1
      const ems = tsToMs(e.clickedAt) ?? sentMs
      if (ems !== null) slot.lastEngagedMs = Math.max(slot.lastEngagedMs ?? 0, ems)
    }
    if (emailIsBounced(e)) slot.bounced += 1
    perContact.set(e.contactId, slot)
  }

  const now = Date.now()
  const rows: ContactEngagement[] = contacts.map((c) => {
    const agg = perContact.get(c.id) ?? {
      sent: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      lastEngagedMs: null,
      lastSentMs: null,
    }
    const daysSinceLastEngaged =
      agg.lastEngagedMs !== null ? (now - agg.lastEngagedMs) / DAY_MS : 9999
    const rawScore =
      agg.opened * 5 + agg.clicked * 15 - agg.bounced * 30 - daysSinceLastEngaged * 0.5
    const score = Math.max(0, Math.min(100, Math.round(rawScore)))

    let status: ContactEngagement['status']
    if (c.unsubscribedAt) status = 'unsubscribed'
    else if (c.bouncedAt || agg.bounced > 0) status = 'bounced'
    else if (score >= 70) status = 'highly-engaged'
    else if (score >= 40) status = 'engaged'
    else if (agg.lastEngagedMs !== null && daysSinceLastEngaged < 60) status = 'cooling'
    else status = 'dormant'

    return {
      contactId: c.id,
      email: c.email ?? '',
      name: c.name ?? '',
      score,
      sent: agg.sent,
      opened: agg.opened,
      clicked: agg.clicked,
      lastEngagedAt: agg.lastEngagedMs !== null ? new Date(agg.lastEngagedMs).toISOString() : null,
      lastSentAt: agg.lastSentMs !== null ? new Date(agg.lastSentMs).toISOString() : null,
      status,
    }
  })

  const filtered = opts?.status ? rows.filter((r) => r.status === opts.status) : rows
  return filtered.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ── Platform leaderboard ────────────────────────────────────────────────────

export async function getPlatformLeaderboard(range: DateRange): Promise<OrgComparisonRow[]> {
  // Pull all orgs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgsSnap = await (adminDb.collection('organizations')).get()
   
  const orgs = orgsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() }) as LeaderboardOrgRow)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((o) => o.deleted !== true)

  const rows: OrgComparisonRow[] = []
  for (const org of orgs) {
    const emails = await fetchEmailsInRange(org.id, range)
    if (emails.length === 0) continue
    let sent = 0
    let delivered = 0
    let opened = 0
    let clicked = 0
    let bounced = 0
    for (const e of emails) {
      sent += 1
      if (emailIsDelivered(e)) delivered += 1
      if (emailIsOpened(e)) opened += 1
      if (emailIsClicked(e)) clicked += 1
      if (emailIsBounced(e)) bounced += 1
    }
    rows.push({
      orgId: org.id,
      orgName: typeof org.name === 'string' ? org.name : org.id,
      sent,
      openRate: safeRate(opened, delivered),
      clickRate: safeRate(clicked, delivered),
      bounceRate: safeRate(bounced, sent),
    })
  }
  return rows.sort((a, b) => b.sent - a.sent)
}

// ── Cohort retention ────────────────────────────────────────────────────────

const MAX_COHORT_SIZE = 5000
const FIRESTORE_IN_LIMIT = 30

/**
 * Returns the UTC Monday at 00:00:00 for the ISO-week containing `ms`.
 */
function isoWeekStartUtc(ms: number): Date {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7 // 0..6, Monday=0
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day, 0, 0, 0, 0),
  )
}

function isoDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Cohort retention curves. Groups contacts by signup-week (ISO Monday) within
 * the range, then for each week-index since signup computes the fraction of
 * cohort members who had an open or click in that calendar week.
 *
 * Capped at 5000 contacts per cohort to keep query fan-out under control.
 */
export async function getCohortAnalysis(
  orgId: string,
  range: DateRange,
  weeksToShow = 12,
): Promise<CohortAnalysis> {
  const safeWeeks = Math.max(1, Math.min(52, weeksToShow))

  // Pull contacts created within the range.
  let contacts: Contact[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = await (adminDb.collection('contacts'))
      .where('orgId', '==', orgId)
      .where('createdAt', '>=', Timestamp.fromDate(range.from))
      .where('createdAt', '<', Timestamp.fromDate(range.to))
      .get()
    contacts = snap.docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d) => ({ id: d.id, ...d.data() } as Contact))
      .filter((c: Contact) => c.deleted !== true)
  } catch {
    // Missing composite index — fall back to scan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = await (adminDb.collection('contacts'))
      .where('orgId', '==', orgId)
      .limit(20_000)
      .get()
    const { fromMs, toMs } = rangeToMillis(range)
    contacts = snap.docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d) => ({ id: d.id, ...d.data() } as Contact))
      .filter((c: Contact) => {
        if (c.deleted === true) return false
        const ms = tsToMs(c.createdAt)
        return ms !== null && ms >= fromMs && ms < toMs
      })
  }

  if (contacts.length === 0) {
    return {
      range: { from: toIso(range.from), to: toIso(range.to) },
      weeksToShow: safeWeeks,
      cohorts: [],
    }
  }

  // Group by ISO-week start (UTC Monday).
  const cohortMap = new Map<string, { start: Date; members: Contact[] }>()
  for (const c of contacts) {
    const ms = tsToMs(c.createdAt)
    if (ms === null) continue
    const startDate = isoWeekStartUtc(ms)
    const key = isoDateKey(startDate)
    const slot = cohortMap.get(key) ?? { start: startDate, members: [] }
    if (slot.members.length < MAX_COHORT_SIZE) slot.members.push(c)
    cohortMap.set(key, slot)
  }

  const sortedCohorts = Array.from(cohortMap.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  )

  // For each cohort, fetch emails for its members and bucket engagement by week.
  const result: CohortRow[] = []
  const nowMs = Date.now()
  for (const cohort of sortedCohorts) {
    const cohortIds = cohort.members.map((m) => m.id)
    const cohortSize = cohortIds.length

    // Determine how many weeks of data we actually have for this cohort.
    const weeksElapsed = Math.min(
      safeWeeks,
      Math.max(
        0,
        Math.floor((nowMs - cohort.start.getTime()) / (7 * DAY_MS)) + 1,
      ),
    )

    if (weeksElapsed === 0 || cohortSize === 0) {
      result.push({
        cohortStart: isoDateKey(cohort.start),
        cohortSize,
        weekIndex: [],
        retentionPercent: [],
      })
      continue
    }

    // For each week-index, track distinct contactIds that engaged.
    const engagedPerWeek: Set<string>[] = []
    for (let i = 0; i < weeksElapsed; i++) engagedPerWeek.push(new Set<string>())

    const cohortEndMs = cohort.start.getTime() + weeksElapsed * 7 * DAY_MS

    // Chunk contactIds into groups of 30 for Firestore `in` queries. We can
    // filter by orgId + contactId-in-chunk AND a time bound — but since the
    // SDK only supports a single `in` per query, we additionally filter by
    // openedAt/clickedAt timestamps in-memory.
    for (let i = 0; i < cohortIds.length; i += FIRESTORE_IN_LIMIT) {
      const chunk = cohortIds.slice(i, i + FIRESTORE_IN_LIMIT)
      if (chunk.length === 0) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = await (adminDb.collection('emails'))
        .where('orgId', '==', orgId)
        .where('contactId', 'in', chunk)
        .where('sentAt', '>=', Timestamp.fromDate(cohort.start))
        .where('sentAt', '<', Timestamp.fromDate(new Date(cohortEndMs)))
        .limit(MAX_EMAILS_PER_QUERY)
        .get()

      for (const doc of snap.docs) {
        const e = { id: doc.id, ...doc.data() } as Email
        if (e.deleted === true) continue
        if (!e.contactId) continue
        // Use the engagement timestamp (open or click). If neither, skip —
        // we're measuring retention via engagement, not raw sends.
        const engagedMs = tsToMs(e.openedAt) ?? tsToMs(e.clickedAt)
        if (engagedMs === null) continue
        const weekIdx = Math.floor((engagedMs - cohort.start.getTime()) / (7 * DAY_MS))
        if (weekIdx < 0 || weekIdx >= weeksElapsed) continue
        engagedPerWeek[weekIdx].add(e.contactId)
      }
    }

    const weekIndex: number[] = []
    const retentionPercent: number[] = []
    for (let i = 0; i < weeksElapsed; i++) {
      weekIndex.push(i)
      const pct =
        cohortSize > 0 ? Math.round((engagedPerWeek[i].size / cohortSize) * 10_000) / 10_000 : 0
      retentionPercent.push(pct)
    }

    result.push({
      cohortStart: isoDateKey(cohort.start),
      cohortSize,
      weekIndex,
      retentionPercent,
    })
  }

  return {
    range: { from: toIso(range.from), to: toIso(range.to) },
    weeksToShow: safeWeeks,
    cohorts: result,
  }
}

// ── Click heatmap (per-broadcast) ───────────────────────────────────────────

/**
 * Parse `<a href="...">` URLs in order from an HTML email body. 1-based
 * positions are returned for each unique URL.
 */
function extractLinkPositions(html: string): Map<string, number> {
  const positions = new Map<string, number>()
  const re = /<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  let pos = 0
  while ((m = re.exec(html)) !== null) {
    pos += 1
    const url = m[1].trim()
    if (!positions.has(url)) positions.set(url, pos)
  }
  return positions
}

/**
 * Per-broadcast link click heatmap. Uses the `shortened_links` collection's
 * per-link `clicks` subcollection where possible, falls back to body-href
 * parsing + per-email `clickedAt` aggregation when the broadcast didn't use
 * shortened links.
 */
export async function getBroadcastHeatmap(
  orgId: string,
  broadcastId: string,
): Promise<BroadcastHeatmap> {
  const bSnap = await adminDb.collection('broadcasts').doc(broadcastId).get()
  if (!bSnap.exists || bSnap.data()?.deleted === true || bSnap.data()?.orgId !== orgId) {
    throw new Error('Broadcast not found')
  }
  const broadcast = { id: bSnap.id, ...bSnap.data() } as Broadcast
  const bodyHtml = broadcast.content?.bodyHtml ?? ''
  const positions = extractLinkPositions(bodyHtml)

  // Find shortened links whose shortCode/shortUrl appears in the broadcast body.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linksSnap = await (adminDb.collection('shortened_links'))
    .where('orgId', '==', orgId)
    .get()
  const referencedLinks = linksSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => ({ id: d.id, ...d.data() }) as ShortenedLinkRow)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l) => {
      if (!bodyHtml) return false
      return (
        (l.shortCode && bodyHtml.includes(l.shortCode)) ||
        (l.shortUrl && bodyHtml.includes(l.shortUrl))
      )
    })

  // Send window — earliest sentAt for this broadcast → +30 days. Used so
  // per-link click rollups don't include unrelated background traffic.
  const startMs =
    tsToMs(broadcast.sendStartedAt) ??
    tsToMs(broadcast.scheduledFor) ??
    tsToMs(broadcast.createdAt) ??
    Date.now() - 90 * DAY_MS
  const windowEndMs = startMs + 60 * DAY_MS

  // Get the set of contactIds that received this broadcast (for unique counts
  // and to filter shortened-link clicks back to this broadcast).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emailsSnap = await (adminDb.collection('emails'))
    .where('orgId', '==', orgId)
    .where('broadcastId', '==', broadcastId)
    .limit(MAX_EMAILS_PER_QUERY)
    .get()
  const recipientIds = new Set<string>()
  for (const doc of emailsSnap.docs) {
    const e = { id: doc.id, ...doc.data() } as Email
    if (e.deleted === true) continue
    if (e.contactId) recipientIds.add(e.contactId)
  }

  // Tally clicks per URL.
  type Agg = { clicks: number; uniqueContactIds: Set<string> }
  const perUrl = new Map<string, Agg>()

  // Helper to add a click.
  const addClick = (url: string, contactId?: string | null) => {
    const a = perUrl.get(url) ?? { clicks: 0, uniqueContactIds: new Set<string>() }
    a.clicks += 1
    if (contactId) a.uniqueContactIds.add(contactId)
    perUrl.set(url, a)
  }

  // Pull per-link click subcollection for each referenced shortened link.
  for (const link of referencedLinks) {
    const url = (link.originalUrl as string) ?? ''
    if (!url) continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clicksSnap = await (adminDb
        .collection('shortened_links')
        .doc(link.id)
        .collection('clicks'))
        .where('timestamp', '>=', Timestamp.fromDate(new Date(startMs)))
        .where('timestamp', '<', Timestamp.fromDate(new Date(windowEndMs)))
        .limit(MAX_EMAILS_PER_QUERY)
        .get()
      for (const c of clicksSnap.docs) {
        const data = c.data()
        const cid: string | undefined = data?.contactId
        // If we can't attribute to a contact, still count the click but
        // only if the click happened in the broadcast send window (we already
        // constrained timestamps above).
        if (cid && !recipientIds.has(cid)) continue
        addClick(url, cid ?? null)
      }
    } catch {
      // Subcollection query may fail without an index — fall back to
      // counting the link's total clickCount in the window. We can't filter
      // by date precisely without the subcollection, so we approximate with
      // 1 unique per recipient who clicked any email in the broadcast.
      const fallbackClicks = typeof link.clickCount === 'number' ? link.clickCount : 0
      if (fallbackClicks > 0) addClick(url)
    }
  }

  // For broadcast bodies that don't use shortened links, fall back to
  // counting `clickedAt` per email and attributing a single click to the
  // first `<a href>` we find in the body.
  if (perUrl.size === 0 && positions.size > 0) {
    let totalClickedEmails = 0
    for (const doc of emailsSnap.docs) {
      const e = { id: doc.id, ...doc.data() } as Email
      if (e.deleted === true) continue
      if (!e.clickedAt) continue
      totalClickedEmails += 1
    }
    if (totalClickedEmails > 0) {
      // Distribute clicks across the body's <a href> tags using the position
      // as a weight — top links get more credit. This is a reasonable
      // heuristic when we lack per-link granularity.
      const urls = Array.from(positions.entries()).sort((a, b) => a[1] - b[1])
      const weights = urls.map((_, i) => urls.length - i) // top link weight=N
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1
      for (let i = 0; i < urls.length; i++) {
        const [url] = urls[i]
        const share = Math.round((totalClickedEmails * weights[i]) / totalWeight)
        if (share > 0) {
          perUrl.set(url, {
            clicks: share,
            uniqueContactIds: new Set<string>(),
          })
        }
      }
    }
  }

  const totalClicks = Array.from(perUrl.values()).reduce((s, v) => s + v.clicks, 0)
  const linkStats: LinkClickStat[] = Array.from(perUrl.entries())
    .map(([url, v]) => ({
      url,
      clicks: v.clicks,
      uniqueClicks: v.uniqueContactIds.size,
      percentOfTotalClicks: totalClicks > 0 ? Math.round((v.clicks / totalClicks) * 10_000) / 10_000 : 0,
      positionInEmail: positions.get(url),
    }))
    .sort((a, b) => b.clicks - a.clicks)

  return { broadcastId, totalClicks, linkStats }
}

// ── Send-time matrix ────────────────────────────────────────────────────────

const SEND_TIME_MIN_SAMPLES = 10

/**
 * 7x24 send-time grid. For each (dayOfWeek, hour) bucket in the org timezone
 * we count sends + opens, and pick best/worst cells (with a min-sample
 * threshold so noisy 1-sample cells don't dominate).
 */
export async function getSendTimeMatrix(
  orgId: string,
  range: DateRange,
): Promise<SendTimeMatrix> {
  // Read org timezone (best-effort).
  let timezone = 'UTC'
  try {
    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    const data = orgSnap.data()
    const tz = data?.settings?.timezone
    if (typeof tz === 'string' && tz.trim()) timezone = tz.trim()
  } catch {
    // Default to UTC.
  }

  const emails = await fetchEmailsInRange(orgId, range)

  // Initialise 7x24 cells.
  const cells: SendTimeCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sent: 0, opened: 0, openRate: 0 })),
  )

  let totalSamples = 0
  for (const e of emails) {
    const sentMs = tsToMs(e.sentAt)
    if (sentMs === null) continue
    const utc = new Date(sentMs)
    let dow = 0
    let hr = 0
    try {
      dow = dayOfWeekInTimezone(utc, timezone)
      hr = hourInTimezone(utc, timezone)
    } catch {
      // Fallback to UTC if Intl rejects the timezone for some reason.
      dow = utc.getUTCDay()
      hr = utc.getUTCHours()
    }
    if (dow < 0 || dow > 6 || hr < 0 || hr > 23) continue
    cells[dow][hr].sent += 1
    if (emailIsOpened(e)) cells[dow][hr].opened += 1
    totalSamples += 1
  }

  // Compute open rates.
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = cells[d][h]
      c.openRate = safeRate(c.opened, c.sent)
    }
  }

  // Find best/worst cells. Require min samples to qualify.
  let bestDay = 0
  let bestHour = 0
  let worstDay = 0
  let worstHour = 0
  let bestRate = -1
  let worstRate = 2 // any rate ≤ 1 will undercut this
  let foundBest = false
  let foundWorst = false
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = cells[d][h]
      if (c.sent < SEND_TIME_MIN_SAMPLES) continue
      if (c.openRate > bestRate) {
        bestRate = c.openRate
        bestDay = d
        bestHour = h
        foundBest = true
      }
      if (c.openRate < worstRate) {
        worstRate = c.openRate
        worstDay = d
        worstHour = h
        foundWorst = true
      }
    }
  }

  // If no cell met the threshold, fall back to the cell with the most sends.
  if (!foundBest || !foundWorst) {
    let maxSent = -1
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (cells[d][h].sent > maxSent) {
          maxSent = cells[d][h].sent
          bestDay = d
          bestHour = h
        }
      }
    }
    worstDay = bestDay
    worstHour = bestHour
  }

  return {
    cells,
    bestDay,
    bestHour,
    worstDay,
    worstHour,
    totalSamples,
    timezone,
  }
}
