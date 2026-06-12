import type { ValidationError } from '@/lib/social/providers'

const LINK_RE = /https?:\/\/[^\s<>"')\]]+|(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')\]]*)?/gi
const TRAILING_PUNCTUATION_RE = /[.,;:!?\u201d\u2019)\]]+$/
const EMAIL_CONTEXT_RE = /[@\w.-]$/

export interface OutboundLinkCheckResult {
  url: string
  ok: boolean
  status?: number
  error?: string
}

export interface OutboundLinkValidationResult {
  valid: boolean
  links: string[]
  results: OutboundLinkCheckResult[]
  errors: ValidationError[]
}

export function extractOutboundLinks(text: string): string[] {
  const links: string[] = []
  LINK_RE.lastIndex = 0

  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[0]
    const index = match.index ?? 0
    const previous = index > 0 ? text.slice(Math.max(0, index - 1), index) : ''

    if (EMAIL_CONTEXT_RE.test(previous)) continue
    if (!raw.includes('.')) continue

    const trimmed = raw.replace(TRAILING_PUNCTUATION_RE, '')
    if (!trimmed) continue

    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    links.push(normalized)
  }

  return Array.from(new Set(links))
}

function isDefinitelyBroken(status?: number): boolean {
  return status === 404 || status === 410
}

async function fetchWithTimeout(url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Partners-in-Biz-Social-Link-Validator/1.0',
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkOutboundLink(url: string, timeoutMs = 5000): Promise<OutboundLinkCheckResult> {
  let lastStatus: number | undefined
  let lastError: string | undefined

  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await fetchWithTimeout(url, method, timeoutMs)
      lastStatus = response.status
      if (response.ok || (response.status >= 300 && response.status < 400)) {
        return { url, ok: true, status: response.status }
      }
      if (isDefinitelyBroken(response.status)) {
        return { url, ok: false, status: response.status }
      }
      // Some valid sites block bots with 401/403/405/429/5xx. Do not block publishing on non-definitive statuses.
      if ([401, 403, 405, 408, 425, 429].includes(response.status) || response.status >= 500) {
        return { url, ok: true, status: response.status }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown link validation error'
    }
  }

  return { url, ok: false, status: lastStatus, error: lastError }
}

export async function validateOutboundLinks(text: string, timeoutMs = 5000): Promise<OutboundLinkValidationResult> {
  const links = extractOutboundLinks(text)
  if (links.length === 0) return { valid: true, links, results: [], errors: [] }

  const results = await Promise.all(links.map(link => checkOutboundLink(link, timeoutMs)))
  const broken = results.filter(result => !result.ok)
  const errors = broken.map(result => ({
    field: 'content.text',
    message: `Outbound link is not reachable (${result.status ?? result.error ?? 'unknown error'}): ${result.url}`,
  }))

  return {
    valid: errors.length === 0,
    links,
    results,
    errors,
  }
}
