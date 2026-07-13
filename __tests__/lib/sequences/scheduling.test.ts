import { evaluateQuietHours } from '@/lib/sequences/scheduling'

describe('evaluateQuietHours', () => {
  it('defers a recipient until the end of overnight quiet hours in their timezone', () => {
    const result = evaluateQuietHours({
      nowUtc: new Date('2026-01-05T04:30:00.000Z'),
      orgTimezone: 'Africa/Johannesburg',
      contactTimezone: 'America/New_York',
      quietHours: { enabled: true, startMinuteLocal: 20 * 60, endMinuteLocal: 8 * 60, timezoneMode: 'recipient' },
    })

    expect(result).toEqual({
      allowed: false,
      timezone: 'America/New_York',
      nextAllowedAt: new Date('2026-01-05T13:00:00.000Z'),
    })
  })

  it('uses the first real instant after a nonexistent DST wall-clock boundary', () => {
    const result = evaluateQuietHours({
      nowUtc: new Date('2026-03-08T06:30:00.000Z'),
      orgTimezone: 'UTC',
      contactTimezone: 'America/New_York',
      quietHours: { enabled: true, startMinuteLocal: 60, endMinuteLocal: 150, timezoneMode: 'recipient' },
    })

    // 02:30 never occurs on the spring-forward day; 03:00 EDT is the first
    // real local instant outside the configured window.
    expect(result.allowed).toBe(false)
    expect(result.nextAllowedAt?.toISOString()).toBe('2026-03-08T07:00:00.000Z')
  })

  it('does not release during the repeated fall-back hour', () => {
    const result = evaluateQuietHours({
      nowUtc: new Date('2026-11-01T05:30:00.000Z'),
      orgTimezone: 'UTC',
      contactTimezone: 'America/New_York',
      quietHours: { enabled: true, startMinuteLocal: 60, endMinuteLocal: 120, timezoneMode: 'recipient' },
    })

    expect(result.allowed).toBe(false)
    expect(result.nextAllowedAt?.toISOString()).toBe('2026-11-01T07:00:00.000Z')
  })

  it('falls back to the organisation timezone when the contact timezone is invalid', () => {
    const result = evaluateQuietHours({
      nowUtc: new Date('2026-01-05T19:30:00.000Z'),
      orgTimezone: 'Africa/Johannesburg',
      contactTimezone: 'Not/AZone',
      quietHours: { enabled: true, startMinuteLocal: 21 * 60, endMinuteLocal: 7 * 60, timezoneMode: 'recipient' },
    })

    expect(result.allowed).toBe(false)
    expect(result.timezone).toBe('Africa/Johannesburg')
    expect(result.nextAllowedAt?.toISOString()).toBe('2026-01-06T05:00:00.000Z')
  })
})
