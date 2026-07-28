/**
 * Revealable redaction markers for linked-computer chat output.
 *
 * True secrets (passwords, bearer tokens, private keys) stay permanently
 * scrubbed. Paths and private URLs are stored as click-to-reveal markers so
 * engineers can still inspect API paths and local paths when working.
 *
 * Format: [[pib-reveal:<kind>|<base64url-utf8>]]
 * Browser-safe: no node:crypto dependency.
 */

export type RevealRedactionKind = 'path' | 'url' | 'token'

export const REVEAL_REDACTION_PATTERN =
  /\[\[pib-reveal:(path|url|token)\|([A-Za-z0-9_-]{1,12000})\]\]/g

const MAX_REVEAL_PAYLOAD_CHARS = 8_000

function utf8ToBase64Url(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64url')
  }
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToUtf8(encoded: string): string | null {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(encoded, 'base64url').toString('utf8')
    }
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
    const binary = atob(padded + pad)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Encode a value as a click-to-reveal placeholder (or permanent if too large). */
export function encodeRevealRedaction(kind: RevealRedactionKind, value: string): string {
  const clean = value.trim()
  if (!clean) return `[redacted-${kind}]`
  if (clean.length > MAX_REVEAL_PAYLOAD_CHARS) return `[redacted-${kind}]`
  try {
    return `[[pib-reveal:${kind}|${utf8ToBase64Url(clean)}]]`
  } catch {
    return `[redacted-${kind}]`
  }
}

export function decodeRevealRedaction(encoded: string): string | null {
  return base64UrlToUtf8(encoded)
}

export function isApiStylePath(path: string): boolean {
  // Web/API endpoints — always keep readable (this is the engineering pain).
  if (/^\/(?:api|v\d+|graphql|healthz?|readyz?|livez?|status|metrics|openapi|swagger|docs)(?:\/|$)/i.test(path)) {
    return true
  }
  // Short relative endpoint-like paths without home-dir roots.
  if (isSensitiveFilesystemPath(path)) return false
  return /^\/[A-Za-z0-9._~-]{1,64}(?:\/[A-Za-z0-9._~-]{1,96}){0,16}\/?$/.test(path)
}

export function isSensitiveFilesystemPath(path: string): boolean {
  return /^\/(?:Users|home|var|etc|root|private|tmp|opt\/homebrew|Library|System|Applications|Volumes|mnt|media)\b/i.test(path)
    || /^\/var\/lib\/hermes\b/i.test(path)
    || /^\/(?:Users|home)\/[^/]+/i.test(path)
}

/** True for long secret-shaped blobs (JWT-ish / high-entropy keys). */
export function isSecretShapedToken(value: string): boolean {
  if (value.length < 40) return false
  // JWT: three base64 segments
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true
  // PEM-ish or pure high-entropy without path separators
  if (value.includes('/')) return false
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value)) {
    return true
  }
  return /^[A-Za-z0-9_-]{48,}$/.test(value)
}

export function labelForRevealKind(kind: RevealRedactionKind): string {
  if (kind === 'url') return 'redacted-url'
  if (kind === 'token') return 'redacted-token'
  return 'redacted-path'
}
