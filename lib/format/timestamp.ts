// lib/format/timestamp.ts
export function fmtTimestamp(ts: unknown, timezone?: string): string {
  if (!ts || typeof ts !== 'object') return ''
  const s = (ts as Record<string, unknown>)._seconds
  if (typeof s !== 'number') return ''
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }
  // Apply caller-supplied timezone; fall back to system locale (en-ZA) if not provided
  if (timezone) options.timeZone = timezone
  return new Date(s * 1000).toLocaleString('en-ZA', options)
}
