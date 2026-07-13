import { isValidIanaTimezone } from '@/lib/email/send-time'
import type { SequenceQuietHours } from './types'

export interface QuietHoursDecision {
  allowed: boolean
  timezone: string
  nextAllowedAt?: Date
}

function resolveTimezone(orgTimezone: string, contactTimezone: string | undefined, mode: SequenceQuietHours['timezoneMode']): string {
  if (mode === 'recipient' && contactTimezone && isValidIanaTimezone(contactTimezone)) return contactTimezone
  if (isValidIanaTimezone(orgTimezone)) return orgTimezone
  return 'UTC'
}

function minuteInTimezone(utc: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utc)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function validMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 24 * 60
}

export function isQuietLocalMinute(minute: number, quietHours: SequenceQuietHours): boolean {
  if (!quietHours.enabled) return false
  const { startMinuteLocal: start, endMinuteLocal: end } = quietHours
  if (!validMinute(start) || !validMinute(end)) return false
  if (start === end) return true
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

/**
 * Evaluates quiet hours against real UTC instants. Searching forward on the
 * UTC timeline makes DST gaps and repeated hours deterministic: nonexistent
 * wall times are skipped and both instances of a repeated quiet hour remain
 * quiet.
 */
export function evaluateQuietHours(args: {
  nowUtc: Date
  orgTimezone: string
  contactTimezone?: string
  quietHours?: SequenceQuietHours
}): QuietHoursDecision {
  const timezone = resolveTimezone(
    args.orgTimezone,
    args.contactTimezone?.trim(),
    args.quietHours?.timezoneMode ?? 'recipient',
  )
  if (!args.quietHours || !isQuietLocalMinute(minuteInTimezone(args.nowUtc, timezone), args.quietHours)) {
    return { allowed: true, timezone }
  }

  const firstMinute = Math.floor(args.nowUtc.getTime() / 60_000) * 60_000 + 60_000
  for (let offset = 0; offset <= 48 * 60; offset++) {
    const candidate = new Date(firstMinute + offset * 60_000)
    if (!isQuietLocalMinute(minuteInTimezone(candidate, timezone), args.quietHours)) {
      return { allowed: false, timezone, nextAllowedAt: candidate }
    }
  }

  // A valid all-day window deliberately has no release instant.
  return { allowed: false, timezone }
}
