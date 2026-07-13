import { sanitizeSequenceQuietHours } from '@/lib/sequences/quiet-hours'

describe('sanitizeSequenceQuietHours', () => {
  it('normalizes a valid quiet-hours policy', () => {
    expect(sanitizeSequenceQuietHours({ enabled: true, startMinuteLocal: 1200, endMinuteLocal: 480, timezoneMode: 'recipient' })).toEqual({
      enabled: true, startMinuteLocal: 1200, endMinuteLocal: 480, timezoneMode: 'recipient',
    })
  })

  it.each([
    [{ enabled: true, startMinuteLocal: -1, endMinuteLocal: 480, timezoneMode: 'recipient' }],
    [{ enabled: true, startMinuteLocal: 1200, endMinuteLocal: 1440, timezoneMode: 'recipient' }],
    [{ enabled: true, startMinuteLocal: 1200.5, endMinuteLocal: 480, timezoneMode: 'recipient' }],
    [{ enabled: true, startMinuteLocal: 1200, endMinuteLocal: 480, timezoneMode: 'browser' }],
  ])('rejects malformed policy %#', (input) => {
    expect(() => sanitizeSequenceQuietHours(input)).toThrow(/Quiet hours/)
  })
})
