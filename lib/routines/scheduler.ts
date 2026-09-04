/**
 * Schedule helpers for PiB bot routines.
 * nextRunAt is approximate (same spirit as hermes-features cron-runtime).
 */

export function computeNextRunAtMs(cron: string, fromMs: number, _tz = 'UTC'): number {
  const from = new Date(fromMs)
  const s = cron.trim().toLowerCase()
  const next = new Date(from.getTime())

  if (s === '@hourly' || s.startsWith('0 * * * *') || s.includes('every hour')) {
    next.setUTCMinutes(0, 0, 0)
    next.setUTCHours(next.getUTCHours() + 1)
    return next.getTime()
  }

  if (
    s === '@daily'
    || s === '0 0 * * *'
    || s.includes('every day')
    || s.includes('daily')
  ) {
    next.setUTCHours(8, 0, 0, 0)
    if (next.getTime() <= fromMs) next.setUTCDate(next.getUTCDate() + 1)
    return next.getTime()
  }

  if (s === '@weekly' || s === '0 0 * * 0') {
    next.setUTCHours(8, 0, 0, 0)
    const day = next.getUTCDay()
    const add = day === 0 ? 7 : 7 - day
    if (next.getTime() <= fromMs) next.setUTCDate(next.getUTCDate() + add)
    else if (day !== 0) next.setUTCDate(next.getUTCDate() + (7 - day))
    return next.getTime()
  }

  // 5-field cron: fire on the next hour boundary (rough placeholder)
  if (/^(\S+\s+){4}\S+$/.test(cron.trim())) {
    next.setUTCMinutes(0, 0, 0)
    next.setUTCHours(next.getUTCHours() + 1)
    if (next.getTime() <= fromMs) next.setUTCHours(next.getUTCHours() + 1)
    return next.getTime()
  }

  // Natural / unknown: 5 minutes out
  return fromMs + 5 * 60_000
}

export function selectDueRoutines<T extends { nextRunAt: number | null; enabled: boolean }>(
  rows: T[],
  nowMs: number,
): T[] {
  return rows.filter(
    (row) => row.enabled && row.nextRunAt != null && row.nextRunAt <= nowMs,
  )
}
