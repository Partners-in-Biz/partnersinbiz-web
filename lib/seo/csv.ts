/**
 * Build a CSV string from an array of row objects.
 * Values containing commas, quotes, or newlines are quoted and escaped.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns?: { key: keyof T; label: string }[],
): string {
  if (rows.length === 0 && !columns) return ''
  const cols = columns ?? (Object.keys(rows[0]) as (keyof T)[]).map((key) => ({ key, label: String(key) }))
  const escape = (value: unknown): string => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = cols.map((c) => escape(c.label)).join(',')
  const body = rows.map((row) => cols.map((c) => escape(row[c.key])).join(',')).join('\n')
  return `${header}\n${body}`
}
