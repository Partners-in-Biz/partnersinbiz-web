/**
 * Live-page Design Audit — URL guard, guarded fetch, and engine runner.
 *
 * T2 of project `2ZybgdBFW3un2Rt6pq0Y`: the user-facing "audit our page"
 * flow. Given a URL the user wants audited, this module validates the URL
 * (http/https only, no embedded credentials, private-network guarded,
 * optional host allowlist), fetches the page server-side with strict caps
 * (bytes, timeout, redirects, content-type), and runs the T1 deterministic
 * engine over the fetched HTML with optional browser-mode hooks
 * (`runtimeErrors` + `computedStyles`) supplied by the agent's workbench
 * browser session.
 *
 * Safety contract:
 * - No arbitrary file writes — everything runs in-memory.
 * - Private/internal hosts are rejected unless the caller explicitly allows
 *   private networks (human-granted), mirroring the workbench browser guard
 *   in `lib/messages/workbench/browser-sessions.ts` (kept local so this
 *   module stays dependency-free like the rest of lib/design-audit).
 * - Redirects are re-validated with the same policy before following.
 */

import { runAudit } from './engine'
import type { AuditResult, AuditScope, DesignSystem } from './types'

export const DESIGN_AUDIT_MAX_URL_LENGTH = 2_048
export const DESIGN_AUDIT_DEFAULT_MAX_BYTES = 1_000_000
export const DESIGN_AUDIT_DEFAULT_TIMEOUT_MS = 10_000
export const DESIGN_AUDIT_DEFAULT_MAX_REDIRECTS = 3
export const DESIGN_AUDIT_MAX_TITLE_LENGTH = 500

/** Host policy for a design audit target URL. */
export interface DesignAuditUrlPolicy {
  /**
   * Optional host allowlist. Entries may be an exact host (`example.com`) or
   * a wildcard suffix (`*.example.com`). When non-empty, only matching hosts
   * are allowed. When empty/omitted, any public http(s) host is allowed.
   */
  allowHosts?: string[]
  /**
   * When true, private/internal hosts (localhost, RFC1918, .local, link-local,
   * etc.) are permitted. Default false. This must come from a human grant,
   * never from an agent self-asserting.
   */
  allowPrivateNetwork?: boolean
}

/** Sanitizes a design-audit URL: http/https only, no credentials, bounded. */
export function sanitizeDesignAuditUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > DESIGN_AUDIT_MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}

/**
 * True when a host targets a private/internal network — localhost, .local,
 * RFC1918, link-local, CGNAT, loopback, multicast, literal IPv6. Mirrors the
 * workbench browser guard (`isPrivateWorkbenchBrowserUrl`) so the design
 * audit never fetches internal surfaces unless the human explicitly allowed
 * private networks.
 */
export function isDesignAuditPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::' || host === '::1' || host === '0.0.0.0') return true
  if (host.includes(':')) return true
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  if (!ipv4) return false
  const [a, b, c] = ipv4
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function hostMatchesAllowlist(host: string, allowHosts: string[]): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  for (const raw of allowHosts) {
    const entry = raw.trim().toLowerCase().replace(/\.$/, '')
    if (!entry) continue
    if (entry === normalized) return true
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1)
      if (normalized.endsWith(suffix)) return true
    }
  }
  return false
}

/**
 * Applies the URL policy: http/https (already enforced by the sanitizer),
 * no private-network host unless allowPrivateNetwork, and an optional host
 * allowlist. Returns a reason string on rejection or null when allowed.
 */
export function designAuditUrlRejectionReason(value: string, policy?: DesignAuditUrlPolicy): string | null {
  const sanitized = sanitizeDesignAuditUrl(value)
  if (!sanitized) return 'URL must be an http(s) URL without embedded credentials'
  let parsed: URL
  try {
    parsed = new URL(sanitized)
  } catch {
    return 'URL must be an http(s) URL without embedded credentials'
  }
  const privateHost = isDesignAuditPrivateHost(parsed.hostname)
  if (privateHost && !policy?.allowPrivateNetwork) {
    return 'Private-network URLs are not allowed for design audits unless the human explicitly allows them'
  }
  if (policy?.allowHosts?.length) {
    const allowed = hostMatchesAllowlist(parsed.hostname, policy.allowHosts)
    if (!allowed) return `Host ${parsed.hostname} is not in the design audit allowlist`
  }
  return null
}

export interface DesignAuditPageFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
}

export type DesignAuditPageFetchResult =
  | { ok: true; html: string; finalUrl: string; title?: string }
  | { ok: false; error: string }

const DESIGN_AUDIT_ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']

function contentTypeAllowed(value: string | null): boolean {
  if (!value) return true
  const main = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!main) return true
  return DESIGN_AUDIT_ALLOWED_CONTENT_TYPES.some((allowed) => main === allowed || main.endsWith(`/${allowed.split('/')[1]}`))
}

/**
 * Fetches a page for design auditing with strict SSRF-style caps: redirects
 * re-validated against the policy, bounded bytes, timeout, and content-type
 * filtering. Never writes to disk.
 */
export async function fetchDesignAuditPage(
  url: string,
  options: DesignAuditPageFetchOptions & { policy?: DesignAuditUrlPolicy } = {},
): Promise<DesignAuditPageFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? DESIGN_AUDIT_DEFAULT_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? DESIGN_AUDIT_DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DESIGN_AUDIT_DEFAULT_MAX_REDIRECTS

  let current = url
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const sanitized = sanitizeDesignAuditUrl(current)
    if (!sanitized) return { ok: false, error: 'URL must be an http(s) URL without embedded credentials' }
    const rejection = designAuditUrlRejectionReason(sanitized, options.policy)
    if (rejection) return { ok: false, error: rejection }

    let response: Response
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        response = await fetchImpl(sanitized, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': 'Partners-in-Biz-Design-Audit/1.0', accept: 'text/html,application/xhtml+xml' },
        })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message.includes('abort') ? 'Design audit fetch timed out' : `Design audit fetch failed: ${message}` }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { ok: false, error: `Redirect without a location header (${response.status})` }
      if (redirect >= maxRedirects) return { ok: false, error: 'Too many redirects' }
      try {
        current = new URL(location, sanitized).toString()
      } catch {
        return { ok: false, error: 'Invalid redirect location' }
      }
      continue
    }

    if (!response.ok) return { ok: false, error: `Design audit fetch failed with HTTP ${response.status}` }
    const contentType = response.headers.get('content-type')
    if (!contentTypeAllowed(contentType)) {
      return { ok: false, error: `Design audit refused non-HTML content (${contentType ?? 'unknown'})` }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) return { ok: false, error: `Design audit page exceeds the ${maxBytes}-byte limit` }
    const html = buffer.toString('utf8')
    const finalUrl = sanitizeDesignAuditUrl(response.url || sanitized) ?? sanitized
    return { ok: true, html, finalUrl }
  }
  return { ok: false, error: 'Too many redirects' }
}

/** Runs the T1 deterministic engine over fetched HTML with optional browser-mode hooks. */
export function runDesignAuditForPage(
  html: string,
  options: {
    scope?: AuditScope
    runtimeErrors?: string[]
    computedStyles?: Record<string, Record<string, string>>
    designSystem?: DesignSystem | null
    fileName?: string
    maxFindingsPerRule?: number
  } = {},
): AuditResult {
  return runAudit(html, {
    scope: options.scope ?? 'all',
    runtimeErrors: options.runtimeErrors ?? [],
    computedStyles: options.computedStyles ?? {},
    designSystem: options.designSystem ?? null,
    fileName: options.fileName ?? '<live-url>',
    maxFindingsPerRule: options.maxFindingsPerRule,
  })
}
