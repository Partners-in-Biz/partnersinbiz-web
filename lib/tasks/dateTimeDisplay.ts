export function timestampToDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') {
      const millis = seconds * 1000
      const nanos = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0
      return new Date(millis + Math.floor(nanos / 1_000_000))
    }
  }
  return null
}

export function formatTaskDate(value: unknown): string | null {
  const date = timestampToDate(value)
  if (!date) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatTaskDateTime(value: unknown): string | null {
  const date = timestampToDate(value)
  if (!date) return null
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
