import {
  isValidIanaTimezone,
  timezoneFor,
  pickSendTime,
  isLocalDeliveryWindowOpen,
} from '@/lib/email/send-time'

describe('isValidIanaTimezone', () => {
  it('accepts well-formed IANA identifiers', () => {
    expect(isValidIanaTimezone('Africa/Johannesburg')).toBe(true)
    expect(isValidIanaTimezone('America/New_York')).toBe(true)
    expect(isValidIanaTimezone('UTC')).toBe(true)
    expect(isValidIanaTimezone('Pacific/Auckland')).toBe(true)
  })

  it('rejects garbage, empty, and non-timezone strings', () => {
    expect(isValidIanaTimezone('Not/AZone')).toBe(false)
    expect(isValidIanaTimezone('')).toBe(false)
    expect(isValidIanaTimezone('   ')).toBe(false)
    expect(isValidIanaTimezone('EST')).toBe(false) // abbreviation, not an IANA zone id
    expect(isValidIanaTimezone('Johannesburg')).toBe(false)
  })

  it('rejects non-string input without throwing', () => {
    // @ts-expect-error deliberately passing a non-string to check the guard
    expect(isValidIanaTimezone(undefined)).toBe(false)
    // @ts-expect-error deliberately passing a non-string to check the guard
    expect(isValidIanaTimezone(null)).toBe(false)
  })
})

describe('timezoneFor', () => {
  it('prefers the contact timezone over the org timezone', () => {
    expect(timezoneFor({ orgTimezone: 'Africa/Johannesburg', contactTimezone: 'America/Chicago' })).toBe(
      'America/Chicago',
    )
  })

  it('falls back to the org timezone when the contact has none', () => {
    expect(timezoneFor({ orgTimezone: 'Europe/London' })).toBe('Europe/London')
  })

  it('falls back to UTC when neither is set or the value is invalid', () => {
    expect(timezoneFor({ orgTimezone: '' })).toBe('UTC')
    expect(timezoneFor({ orgTimezone: 'Not/AZone' })).toBe('UTC')
  })
})

describe('pickSendTime — org timezone resolution', () => {
  it('resolves recipient local time against the org timezone when no contact timezone exists', () => {
    // Monday 2026-01-05 08:00 UTC. Org tz = Africa/Johannesburg (UTC+2, no DST)
    // so local time is 10:00 — before the 9am... wait, past it. Use preferred
    // hour 14 so the same-day branch is exercised deterministically.
    const scheduled = new Date(Date.UTC(2026, 0, 5, 8, 0, 0)) // Mon 08:00 UTC = 10:00 SAST
    const result = pickSendTime(scheduled, {
      orgTimezone: 'Africa/Johannesburg',
      preferredHourLocal: 14,
      preferredDaysOfWeek: [1, 2, 3, 4, 5],
    })

    // 14:00 SAST on the same Monday = 12:00 UTC.
    expect(result.toISOString()).toBe('2026-01-05T12:00:00.000Z')
  })

  it('uses the contact timezone instead of the org timezone when present', () => {
    const scheduled = new Date(Date.UTC(2026, 0, 5, 8, 0, 0))
    const result = pickSendTime(scheduled, {
      orgTimezone: 'Africa/Johannesburg',
      contactTimezone: 'America/New_York',
      preferredHourLocal: 9,
      preferredDaysOfWeek: [1, 2, 3, 4, 5],
    })

    // 09:00 America/New_York (EST, UTC-5) on Mon 2026-01-05 = 14:00 UTC.
    expect(result.toISOString()).toBe('2026-01-05T14:00:00.000Z')
  })

  it('falls back to UTC math when the org timezone is invalid, instead of throwing', () => {
    const scheduled = new Date(Date.UTC(2026, 0, 5, 1, 0, 0))
    expect(() =>
      pickSendTime(scheduled, {
        orgTimezone: 'Not/AZone',
        preferredHourLocal: 9,
        preferredDaysOfWeek: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow()
  })
})

describe('isLocalDeliveryWindowOpen — org timezone resolution', () => {
  it('opens the window once the contact local time reaches the org-intended hour', () => {
    // scheduledFor 09:00 in org tz Africa/Johannesburg (UTC+2) = 07:00 UTC.
    const scheduledForUtc = new Date(Date.UTC(2026, 0, 5, 7, 0, 0))
    // Contact is in America/New_York (UTC-5): 09:00 local there is 14:00 UTC.
    const beforeWindow = new Date(Date.UTC(2026, 0, 5, 13, 0, 0))
    const atWindow = new Date(Date.UTC(2026, 0, 5, 14, 0, 0))

    expect(
      isLocalDeliveryWindowOpen({
        nowUtc: beforeWindow,
        scheduledForUtc,
        orgTimezone: 'Africa/Johannesburg',
        contactTimezone: 'America/New_York',
        windowHours: 24,
      }),
    ).toBe(false)

    expect(
      isLocalDeliveryWindowOpen({
        nowUtc: atWindow,
        scheduledForUtc,
        orgTimezone: 'Africa/Johannesburg',
        contactTimezone: 'America/New_York',
        windowHours: 24,
      }),
    ).toBe(true)
  })

  it('sends regardless once the fallback window expires', () => {
    const scheduledForUtc = new Date(Date.UTC(2026, 0, 5, 7, 0, 0))
    const wayLater = new Date(Date.UTC(2026, 0, 6, 8, 0, 0)) // +25h

    expect(
      isLocalDeliveryWindowOpen({
        nowUtc: wayLater,
        scheduledForUtc,
        orgTimezone: 'Africa/Johannesburg',
        contactTimezone: 'Pacific/Auckland',
        windowHours: 24,
      }),
    ).toBe(true)
  })
})
