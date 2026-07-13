import type { SequenceQuietHours } from './types'

export function sanitizeSequenceQuietHours(input: unknown): SequenceQuietHours {
  if (!input || typeof input !== 'object') throw new Error('Quiet hours must be an object')
  const value = input as Record<string, unknown>
  const start = Number(value.startMinuteLocal)
  const end = Number(value.endMinuteLocal)
  const mode = value.timezoneMode
  if (
    !Number.isInteger(start) || start < 0 || start >= 1440 ||
    !Number.isInteger(end) || end < 0 || end >= 1440 ||
    (mode !== 'recipient' && mode !== 'organization')
  ) {
    throw new Error('Quiet hours must use valid local minutes and timezone mode')
  }
  return {
    enabled: value.enabled === true,
    startMinuteLocal: start,
    endMinuteLocal: end,
    timezoneMode: mode,
  }
}
