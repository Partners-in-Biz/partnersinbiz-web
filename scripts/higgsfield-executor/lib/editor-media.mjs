export const DEFAULT_ALLOWED_MEDIA_HOSTS = [
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'partnersinbiz.online',
  'www.partnersinbiz.online',
]

export const DEFAULT_ALLOWED_MEDIA_HOST_SUFFIXES = [
  '.cloudfront.net',
  '.higgsfield.ai',
  '.fal.media',
]

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

export function isPrivateIpLiteral(hostname) {
  const host = String(hostname).toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.includes(':')) return true
  if (!IPV4_LITERAL.test(host)) return false
  const parts = host.split('.').map(Number)
  if (parts.some((part) => part > 255)) return false
  const [a, b] = parts
  return (
    a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  )
}

export function assertAllowedMediaUrl(url, options = {}) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    throw new Error(`invalid media url: ${String(url).slice(0, 120)}`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`media url must be https: ${parsed.href.slice(0, 120)}`)
  if (parsed.username || parsed.password) throw new Error('media url must not embed credentials')
  const hostname = parsed.hostname.toLowerCase()
  if (isPrivateIpLiteral(hostname) || IPV4_LITERAL.test(hostname)) {
    throw new Error(`media url host must be a public DNS name, not an IP literal: ${hostname}`)
  }
  const exactHosts = [...DEFAULT_ALLOWED_MEDIA_HOSTS, ...(options.extraHosts ?? []).map((host) => String(host).toLowerCase())]
  if (exactHosts.includes(hostname)) return parsed
  if (DEFAULT_ALLOWED_MEDIA_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return parsed
  throw new Error(`media url host is not on the editor download allowlist: ${hostname}`)
}
