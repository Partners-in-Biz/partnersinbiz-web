/** http(s) or same-origin conversation attachment paths. Rejects javascript:/data:. */
export function isAllowedPartUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false
  }
  if (trimmed.startsWith('/api/v1/conversations/')) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
