// lib/email/rss-automation.ts
//
// Types + scheduling helpers for the "RSS digest" automation (US-145).
//
// Firestore collection: `rss_automations`
//   {
//     orgId: string
//     name: string
//     feedUrl: string
//     enabled: boolean
//     schedule: { cadence: 'daily' | 'weekly'; hourLocal: number (0-23);
//                 dayOfWeek?: number (0=Sun..6=Sat, weekly only); timezone?: string }
//     subject: string                // template, supports {{latest_post_title}} etc.
//     bodyHtml: string               // template, supports {{posts_html}} etc.
//     recipient: { kind: 'segment' | 'tag' | 'contacts';
//                  segmentId?: string; tag?: string; contactIds?: string[] }
//     maxItems: number               // posts per digest (default 5)
//     lastRunAt: Timestamp | null
//     lastPostGuid: string           // guid of newest post sent last run (dedupe)
//     lastSentCount: number
//     createdAt / updatedAt: Timestamp
//     deleted: boolean
//   }

import type { Timestamp } from 'firebase-admin/firestore'

export type RssCadence = 'daily' | 'weekly'

export interface RssSchedule {
  cadence: RssCadence
  /** Hour of day (0-23) in the schedule timezone the digest should go out. */
  hourLocal: number
  /** 0=Sunday .. 6=Saturday. Only used when cadence === 'weekly'. */
  dayOfWeek?: number
  /** IANA timezone. Defaults to UTC when unset. */
  timezone?: string
}

export type RssRecipient =
  | { kind: 'segment'; segmentId: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'contacts'; contactIds: string[] }

export interface RssAutomation {
  id: string
  orgId: string
  name: string
  feedUrl: string
  enabled: boolean
  schedule: RssSchedule
  subject: string
  bodyHtml: string
  recipient: RssRecipient
  maxItems: number
  lastRunAt: Timestamp | null
  lastPostGuid: string
  lastSentCount: number
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted: boolean
}

export type RssAutomationInput = Omit<
  RssAutomation,
  'id' | 'lastRunAt' | 'lastPostGuid' | 'lastSentCount' | 'createdAt' | 'updatedAt' | 'deleted'
>

export const DEFAULT_RSS_SUBJECT = 'New from {{feed_title}}: {{latest_post_title}}'
export const DEFAULT_RSS_BODY_HTML =
  '<p>Here are the latest posts:</p>{{posts_html}}<p style="margin-top:20px;font-size:12px;color:#888;">' +
  'You are receiving this digest because you subscribed to updates.</p>'

// ── Validation / sanitisation ────────────────────────────────────────────────

function clampHour(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return 9
  return Math.min(23, Math.max(0, Math.round(n)))
}

function clampDow(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return 1
  return Math.min(6, Math.max(0, Math.round(n)))
}

export function sanitizeSchedule(input: unknown): RssSchedule {
  const src = (input ?? {}) as Record<string, unknown>
  const cadence: RssCadence = src.cadence === 'weekly' ? 'weekly' : 'daily'
  const schedule: RssSchedule = {
    cadence,
    hourLocal: clampHour(src.hourLocal),
  }
  if (cadence === 'weekly') schedule.dayOfWeek = clampDow(src.dayOfWeek)
  if (typeof src.timezone === 'string' && src.timezone.trim()) {
    schedule.timezone = src.timezone.trim()
  }
  return schedule
}

export function sanitizeRecipient(input: unknown): RssRecipient | null {
  const src = (input ?? {}) as Record<string, unknown>
  if (src.kind === 'segment' && typeof src.segmentId === 'string' && src.segmentId.trim()) {
    return { kind: 'segment', segmentId: src.segmentId.trim() }
  }
  if (src.kind === 'tag' && typeof src.tag === 'string' && src.tag.trim()) {
    return { kind: 'tag', tag: src.tag.trim() }
  }
  if (src.kind === 'contacts' && Array.isArray(src.contactIds)) {
    const ids = src.contactIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    if (ids.length > 0) return { kind: 'contacts', contactIds: ids }
  }
  return null
}

export interface RssValidationResult {
  ok: boolean
  error?: string
  value?: RssAutomationInput
}

export function validateRssAutomationInput(
  body: Record<string, unknown>,
  orgId: string,
): RssValidationResult {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, error: 'name is required' }

  const feedUrl = typeof body.feedUrl === 'string' ? body.feedUrl.trim() : ''
  if (!feedUrl) return { ok: false, error: 'feedUrl is required' }
  try {
    const parsed = new URL(feedUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'feedUrl must be an http(s) URL' }
    }
  } catch {
    return { ok: false, error: 'feedUrl is not a valid URL' }
  }

  const recipient = sanitizeRecipient(body.recipient)
  if (!recipient) {
    return { ok: false, error: 'recipient must be a segment, tag, or non-empty contacts list' }
  }

  const maxItemsRaw =
    typeof body.maxItems === 'number' ? body.maxItems : parseInt(String(body.maxItems ?? ''), 10)
  const maxItems = Number.isFinite(maxItemsRaw) ? Math.min(20, Math.max(1, Math.round(maxItemsRaw))) : 5

  const value: RssAutomationInput = {
    orgId,
    name,
    feedUrl,
    enabled: body.enabled !== false,
    schedule: sanitizeSchedule(body.schedule),
    subject:
      typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : DEFAULT_RSS_SUBJECT,
    bodyHtml:
      typeof body.bodyHtml === 'string' && body.bodyHtml.trim() ? body.bodyHtml : DEFAULT_RSS_BODY_HTML,
    recipient,
    maxItems,
  }
  return { ok: true, value }
}

// ── Due-check ────────────────────────────────────────────────────────────────

/**
 * Compute the local hour + day-of-week for a given instant in a timezone.
 * Uses Intl so we don't pull in a tz library. Falls back to UTC on bad tz.
 */
function localParts(now: Date, timezone?: string): { hour: number; dow: number; dayKey: string } {
  const tz = timezone || 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = fmt.formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    let hour = parseInt(get('hour'), 10)
    if (hour === 24) hour = 0
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    }
    const dow = weekdayMap[get('weekday')] ?? now.getUTCDay()
    const dayKey = `${get('year')}-${get('month')}-${get('day')}`
    return { hour: Number.isFinite(hour) ? hour : now.getUTCHours(), dow, dayKey }
  } catch {
    return {
      hour: now.getUTCHours(),
      dow: now.getUTCDay(),
      dayKey: now.toISOString().slice(0, 10),
    }
  }
}

function lastRunDayKey(lastRunAt: Date | null, timezone?: string): string | null {
  if (!lastRunAt) return null
  return localParts(lastRunAt, timezone).dayKey
}

/**
 * Is this automation due to send at `now`?
 *
 * Rules:
 *  - The current local hour (in the schedule's tz) must have reached/passed
 *    the configured `hourLocal`.
 *  - For weekly schedules, the current local day-of-week must match.
 *  - It must not have already run today (local-day granularity), so a cron
 *    that ticks hourly only fires the digest once per scheduled day.
 */
export function isRssAutomationDue(
  automation: Pick<RssAutomation, 'enabled' | 'schedule'> & { lastRunAt: Date | null },
  now: Date,
): boolean {
  if (!automation.enabled) return false
  const { schedule } = automation
  const { hour, dow, dayKey } = localParts(now, schedule.timezone)

  if (hour < schedule.hourLocal) return false
  if (schedule.cadence === 'weekly' && schedule.dayOfWeek !== undefined && dow !== schedule.dayOfWeek) {
    return false
  }
  // Already ran this local day → not due again until next scheduled day.
  const ranKey = lastRunDayKey(automation.lastRunAt, schedule.timezone)
  if (ranKey === dayKey) return false
  return true
}
