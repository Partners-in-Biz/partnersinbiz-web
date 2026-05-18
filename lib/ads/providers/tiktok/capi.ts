// lib/ads/providers/tiktok/capi.ts
// TikTok Events API (server-side conversions) — v1.3
// Endpoint: POST https://business-api.tiktok.com/open_api/v1.3/pixel/track/
// Ref: https://business-api.tiktok.com/portal/docs?id=1771100865818625

import { createHash } from 'crypto'
import { TIKTOK_ADS_API_BASE } from './constants'
import { sha256Email, sha256Phone } from './audiences-hash'

export interface TiktokConversionUser {
  email?: string
  phone?: string
  /** ttclid — TikTok click id from URL parameter (raw, NOT hashed) */
  ttclid?: string
  /** TikTok first-party cookie _ttp (raw, NOT hashed) */
  ttp?: string
  /** External ID — pass any stable identifier; will be SHA-256 hashed server-side */
  externalId?: string
  userAgent?: string
  ip?: string
}

export interface TiktokConversionEventInput {
  /** TikTok pixel id (the "Pixel Code" shown in Events Manager) */
  pixelCode: string
  /**
   * Standard TikTok event name.
   * Examples: 'Purchase' | 'CompletePayment' | 'AddToCart' | 'Subscribe' |
   *           'Lead' | 'CompleteRegistration' | 'ViewContent' | 'Search'
   */
  eventName: string
  /** Dedupe key — TikTok deduplicates against pixel-side events with the same event_id */
  eventId: string
  /** ISO 8601 timestamp of when the conversion happened */
  eventTimeIso: string
  user: TiktokConversionUser
  value?: number
  /** ISO 4217 currency code — required when value is set */
  currency?: string
  contentId?: string
  pageUrl?: string
}

export interface TiktokCapiCallArgs {
  /** Events API access token (obtained from TikTok Events Manager → Settings → Generate Token) */
  capiAccessToken: string
  /** Test event code from TikTok Events Manager → Test Events — include for staging/QA only */
  testEventCode?: string
  /** Injected fetch implementation — defaults to global fetch; use for testing */
  fetchImpl?: typeof fetch
}

export interface TiktokCapiResult {
  ok: true
  status: number
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input.trim().toLowerCase(), 'utf8').digest('hex')
}

function tryHash(
  input: string | undefined,
  hasher: (s: string) => string,
): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  if (trimmed.length === 0) return undefined
  try {
    return hasher(trimmed)
  } catch {
    return undefined
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the request body for the TikTok Events API.
 * Throws when no user identifier is present (TikTok requires at least one of:
 * email, phone, external_id, ttclid, ttp).
 */
export function buildEventBody(
  input: TiktokConversionEventInput,
  testEventCode?: string,
): Record<string, unknown> {
  const emailHash = tryHash(input.user.email, sha256Email)
  const phoneHash = tryHash(input.user.phone, sha256Phone)
  const externalIdHash = tryHash(input.user.externalId, sha256Hex)

  // Build context.user — only include fields that hashed successfully
  const userCtx: Record<string, unknown> = {}
  if (emailHash) userCtx.email = emailHash
  if (phoneHash) userCtx.phone_number = phoneHash
  if (externalIdHash) userCtx.external_id = externalIdHash

  // Require at least one identifier (hashed or raw)
  const hasIdentifier =
    Object.keys(userCtx).length > 0 ||
    (typeof input.user.ttclid === 'string' && input.user.ttclid.length > 0) ||
    (typeof input.user.ttp === 'string' && input.user.ttp.length > 0)

  if (!hasIdentifier) {
    throw new Error(
      'buildEventBody: at least one identifier (email / phone / externalId / ttclid / ttp) is required',
    )
  }

  // Build context object
  const context: Record<string, unknown> = { user: userCtx }

  if (input.user.userAgent) context.user_agent = input.user.userAgent
  if (input.user.ip) context.ip = input.user.ip
  if (input.pageUrl) context.page = { url: input.pageUrl }

  // ttclid goes into context.ad.callback (raw, per TikTok spec)
  if (input.user.ttclid || input.user.ttp) {
    const ad: Record<string, unknown> = {}
    if (input.user.ttclid) ad.callback = input.user.ttclid
    context.ad = ad
  }

  // Build properties
  const properties: Record<string, unknown> = {}
  if (input.value !== undefined) properties.value = input.value
  if (input.currency) properties.currency = input.currency
  if (input.contentId) properties.content_id = input.contentId

  // Assemble final body
  const body: Record<string, unknown> = {
    pixel_code: input.pixelCode,
    event: input.eventName,
    event_id: input.eventId,
    timestamp: input.eventTimeIso,
    context,
  }

  if (Object.keys(properties).length > 0) body.properties = properties
  if (testEventCode) body.test_event_code = testEventCode

  return body
}

/**
 * Send a server-side conversion event to the TikTok Events API.
 * Returns `{ ok: true, status }` on success.
 * Throws on HTTP error or when the API returns `code !== 0`.
 */
export async function trackConversion(
  args: TiktokCapiCallArgs & { input: TiktokConversionEventInput },
): Promise<TiktokCapiResult> {
  const body = buildEventBody(args.input, args.testEventCode)
  const url = `${TIKTOK_ADS_API_BASE}/pixel/track/`
  const fetchImpl = args.fetchImpl ?? fetch

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Access-Token': args.capiAccessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok Events API HTTP ${res.status} — ${text.slice(0, 200)}`)
  }

  const env = (await res.json()) as { code: number; message: string }
  if (env.code !== 0) {
    throw new Error(`TikTok Events API error: code=${env.code} message=${env.message}`)
  }

  return { ok: true, status: res.status }
}
