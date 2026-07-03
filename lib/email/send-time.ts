// lib/email/send-time.ts
//
// Timezone-aware send-time helpers. Uses the built-in `Intl.DateTimeFormat`
// to read the local clock + day-of-week in an IANA timezone (no extra deps)
// and a small UTC-roundtrip trick to convert a target local clock time back
// into a UTC instant.
//
// Used by:
//   • app/api/cron/sequences/route.ts — when advancing a contact to the next
//     step we compute nextSendAt = (now + delayDays) pushed forward to the
//     next preferred day-of-week + preferred hour-of-day in the contact's
//     (or org's) timezone.
//   • app/api/cron/broadcasts/route.ts — when broadcast.audienceLocalDelivery
//     is on we send to each contact only when their local clock has reached
//     the broadcast's target local-hour (skipping them this tick otherwise).

export interface SendTimeContext {
  orgTimezone: string
  contactTimezone?: string
  preferredHourLocal: number    // 0-23
  preferredDaysOfWeek: number[] // [0..6] (0 = Sun)
}

/**
 * True when `tz` is a real IANA timezone identifier. Prefers
 * `Intl.supportedValuesOf('timeZone')` (Node 18.13+ / modern browsers) when
 * available, falling back to instantiating a formatter (which throws
 * `RangeError` on an invalid zone) for older runtimes.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false
  const value = tz.trim()
  // 'UTC' is a valid Intl timezone and is used as our internal fallback
  // (see timezoneFor below), but Intl.supportedValuesOf('timeZone') omits it
  // on some runtimes (it enumerates IANA zone names; UTC is a special alias
  // for Etc/UTC). Accept it explicitly rather than rejecting a value we
  // ourselves treat as canonical.
  if (value === 'UTC') return true
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supported === 'function') {
      return supported('timeZone').includes(value)
    }
  } catch {
    // supportedValuesOf unsupported/throwing — fall through to the formatter check.
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const VALID_HOURS = (h: number) => Number.isFinite(h) && h >= 0 && h <= 23
const VALID_DAYS = (ds: number[]) => Array.isArray(ds) && ds.length > 0 && ds.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)

/**
 * Returns the timezone to use for the contact. Falls back to UTC when the
 * org has no timezone set, so the math still works.
 */
export function timezoneFor(ctx: { orgTimezone: string; contactTimezone?: string }): string {
  const tz = (ctx.contactTimezone && ctx.contactTimezone.trim()) || (ctx.orgTimezone && ctx.orgTimezone.trim()) || 'UTC'
  // Test it by trying to instantiate a formatter — if invalid, fall back.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/**
 * 0..23 hour-of-day at `utc` as seen in `timezone`. Implemented via
 * Intl.DateTimeFormat so DST is handled correctly.
 */
export function hourInTimezone(utc: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(utc)
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0'
  let h = parseInt(hourPart, 10)
  // Some platforms emit "24" for midnight when hour12=false. Normalise.
  if (h === 24) h = 0
  return h
}

/**
 * 0..6 day-of-week at `utc` as seen in `timezone`. 0 = Sunday.
 */
export function dayOfWeekInTimezone(utc: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
  const parts = fmt.formatToParts(utc)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0
}

/**
 * Extract `{year, monthIndex0, day}` for a UTC instant as seen in a timezone.
 * Used internally to "rotate" the local clock day forward.
 */
function dateComponentsInTimezone(utc: Date, timezone: string): {
  year: number
  monthIndex0: number
  day: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(utc)
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
  return {
    year: get('year'),
    monthIndex0: get('month') - 1,
    day: get('day'),
  }
}

/**
 * Convert a "wall clock" local time (year, monthIndex0, day, hour, minute) in
 * a given IANA timezone to a real UTC instant.
 *
 * Algorithm: treat the inputs as if they were UTC, compute the corresponding
 * "as seen in the target timezone" offset, then subtract that offset. We
 * iterate twice to land DST-correctly on transition days.
 */
export function localToUtc(
  year: number,
  monthIndex0: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Initial guess: take the inputs as UTC. This is wrong by exactly the
  // timezone offset, which we now measure and subtract.
  let utcGuess = Date.UTC(year, monthIndex0, day, hour, minute, 0, 0)
  for (let i = 0; i < 2; i++) {
    const d = new Date(utcGuess)
    // How does our current guess look in the target timezone?
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(d)
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
    let asLocalHour = get('hour')
    if (asLocalHour === 24) asLocalHour = 0
    const asLocalAsUtcMillis = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      asLocalHour,
      get('minute'),
      get('second'),
      0,
    )
    // diff = offset of target tz from UTC at this instant.
    const offsetMs = asLocalAsUtcMillis - utcGuess
    // Our target "looks like" (year,m,d,h,min,0) in local. Re-anchor the
    // guess so that subtracting offset hits the requested wall time.
    const targetWallMs = Date.UTC(year, monthIndex0, day, hour, minute, 0, 0)
    utcGuess = targetWallMs - offsetMs
  }
  return new Date(utcGuess)
}

/**
 * Pick the optimal UTC send time. Starts from `scheduledForUtc`, then:
 *   1. Reads the local-clock date in the contact's timezone.
 *   2. If that date is a preferred day AND we haven't yet passed the
 *      preferred hour, target preferred-hour today.
 *   3. Otherwise advance day-by-day (up to 7 iterations) until we find a
 *      preferred day-of-week, and target preferred-hour that day.
 *   4. Converts the chosen (date, hour, 00 minute) back to a UTC Date.
 *
 * If the scheduledForUtc is already past preferred-hour on a valid day, we
 * still push forward to the *next* valid day-hour — this means recipients
 * never get an email at e.g. 23:00 just because the cron caught up late.
 */
export function pickSendTime(scheduledForUtc: Date, ctx: SendTimeContext): Date {
  const tz = timezoneFor(ctx)
  const hour = VALID_HOURS(ctx.preferredHourLocal) ? ctx.preferredHourLocal : 9
  const days = VALID_DAYS(ctx.preferredDaysOfWeek) ? ctx.preferredDaysOfWeek : [1, 2, 3, 4, 5]
  const daySet = new Set<number>(days)

  // Start from the scheduled instant's local-date.
  const startLocalHour = hourInTimezone(scheduledForUtc, tz)
  const startDow = dayOfWeekInTimezone(scheduledForUtc, tz)
  const startDate = dateComponentsInTimezone(scheduledForUtc, tz)

  // Same-day candidate: scheduled hour hasn't yet hit preferred hour.
  if (daySet.has(startDow) && startLocalHour < hour) {
    return localToUtc(startDate.year, startDate.monthIndex0, startDate.day, hour, 0, tz)
  }

  // Walk forward day by day. Use a millis cursor on a UTC-noon anchor in
  // local so DST shifts don't flip us into the wrong day.
  for (let offset = 1; offset <= 14; offset++) {
    // Build a UTC instant ~24h forward from `scheduledForUtc + offset days`
    // and re-read components in the target timezone.
    const probe = new Date(scheduledForUtc.getTime() + offset * 24 * 60 * 60 * 1000)
    const dow = dayOfWeekInTimezone(probe, tz)
    if (!daySet.has(dow)) continue
    const dc = dateComponentsInTimezone(probe, tz)
    return localToUtc(dc.year, dc.monthIndex0, dc.day, hour, 0, tz)
  }

  // Pathological config (e.g. days = []): just honour preferred hour today.
  return localToUtc(startDate.year, startDate.monthIndex0, startDate.day, hour, 0, tz)
}

/**
 * For broadcasts with `audienceLocalDelivery=true`. Returns true when the
 * current UTC time is at or past the broadcast's target local hour in the
 * contact's timezone on (or after) the broadcast's target local date.
 *
 * The broadcast's `scheduledFor` UTC encodes a wall-clock time in the org's
 * timezone — we read its local hour-of-day in the org tz, then check the
 * same wall hour-of-day in the contact's tz on the same calendar day.
 */
export function isLocalDeliveryWindowOpen(args: {
  nowUtc: Date
  scheduledForUtc: Date
  orgTimezone: string
  contactTimezone?: string
  windowHours: number    // e.g. 24 — after which we send regardless
}): boolean {
  const orgTz = (args.orgTimezone && args.orgTimezone.trim()) || 'UTC'
  const contactTz = timezoneFor({ orgTimezone: orgTz, contactTimezone: args.contactTimezone })

  // Target local hour-of-day from the org's intent.
  const targetHour = hourInTimezone(args.scheduledForUtc, orgTz)
  const targetDateComponents = dateComponentsInTimezone(args.scheduledForUtc, orgTz)

  // Convert the "target wall time in contact tz" back to UTC. That's the
  // earliest instant we should send for this contact.
  const contactSendUtc = localToUtc(
    targetDateComponents.year,
    targetDateComponents.monthIndex0,
    targetDateComponents.day,
    targetHour,
    0,
    contactTz,
  )

  if (args.nowUtc.getTime() >= contactSendUtc.getTime()) return true

  // After the windowHours expires, send regardless of contact's local time.
  const windowExpiry = args.scheduledForUtc.getTime() + args.windowHours * 60 * 60 * 1000
  if (args.nowUtc.getTime() >= windowExpiry) return true

  return false
}
