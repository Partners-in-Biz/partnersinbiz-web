/**
 * Browser-safe ZAR formatting helpers for the admin billing control plane.
 *
 * Kept free of firebase-admin imports so it can be used in client components.
 */

/** Format a major-unit ZAR amount (Rands) as "R1,499". */
export function formatZar(amount: number, opts?: { decimals?: boolean }): string {
  const value = Number.isFinite(amount) ? amount : 0
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(value)
}

/** Format a 0-1 ratio as a percent string, e.g. 0.042 -> "4.2%". */
export function formatPct(ratio: number, digits = 1): string {
  const value = Number.isFinite(ratio) ? ratio : 0
  return `${(value * 100).toFixed(digits)}%`
}

/** Format a YYYY-MM bucket key as a short month label, e.g. "Jun 26". */
export function formatMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' })
}

const INTERVAL_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  once_off: 'Once-off',
}

export function intervalLabel(interval: string): string {
  return INTERVAL_LABELS[interval] ?? interval
}

const INTERVAL_SUFFIX: Record<string, string> = {
  monthly: '/mo',
  quarterly: '/qtr',
  annual: '/yr',
  once_off: '',
}

export function intervalSuffix(interval: string): string {
  return INTERVAL_SUFFIX[interval] ?? ''
}

/** Convert a Firestore-ish timestamp value to millis (browser-safe). */
export function tsToMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'object') {
    const v = value as { seconds?: number; _seconds?: number; toMillis?: () => number }
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis() } catch { return null }
    }
    const seconds = v.seconds ?? v._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

/** Format millis as a short date, e.g. "23 Jun 2026". */
export function formatDate(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Days remaining until a future millis timestamp (negative if past). */
export function daysUntil(ms: number | null): number | null {
  if (!ms) return null
  return Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000))
}
