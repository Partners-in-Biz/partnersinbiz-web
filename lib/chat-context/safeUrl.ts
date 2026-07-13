export function safePreviewUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, typeof window === 'undefined' ? 'https://partnersinbiz.com' : window.location.origin)
    const relative = value.startsWith('/') && !value.startsWith('//')
    if (relative) return `${url.pathname}${url.search}${url.hash}`
    if (url.protocol === 'https:') return url.toString()
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.toString()
  } catch { /* invalid URLs are intentionally omitted */ }
  return undefined
}
