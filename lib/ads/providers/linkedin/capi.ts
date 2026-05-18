// lib/ads/providers/linkedin/capi.ts
// LinkedIn Conversions API client. Sub-3b Phase 5 Batch 1.
//
// POSTs server-side conversion events to /rest/conversionEvents with
// SHA-256 hashed PII + LinkedIn first-party cookie raw. Dedupe via eventId.
// Token is the separately-scoped rw_conversions token persisted on
// AdPixelConfig.linkedin.capiTokenEnc.

import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'
import { sha256Email, sha256Phone } from './audiences-hash'

export interface LinkedinConversionUser {
  email?: string
  phone?: string
  /** li_fat_id — LinkedIn first-party cookie ID. Sent raw (NOT hashed). */
  liFatId?: string
  /** ACXIOM_ID — third-party identity provider id (optional). */
  acxiomId?: string
  /** ORACLE_MOAT_ID — third-party identity provider id (optional). */
  oracleMoatId?: string
}

export interface LinkedinConversionEventInput {
  /** LinkedIn conversion URN. Format: 'urn:lla:llaPartnerConversion:{id}' OR the bare numeric id (we compose the URN). */
  conversionId: string
  /** Event timestamp in epoch milliseconds. */
  eventTimeMs: number
  user: LinkedinConversionUser
  /** Optional monetary value. */
  value?: { amount: number | string; currencyCode: string }
  /** Unique event id for dedupe (shared with Meta CAPI + browser pixel for cross-channel dedupe). */
  eventId: string
}

export interface LinkedinCapiCallArgs {
  /** The rw_conversions-scoped access token. Decrypted by caller. */
  capiAccessToken: string
  version?: string
  /** Optional test mode signal. */
  testEventCode?: string
  /** Inject fetch for testing. */
  fetchImpl?: typeof fetch
}

export interface LinkedinCapiResult {
  ok: true
  status: number
}

/** Hash email if present + non-empty; return undefined to drop from userIds. */
function tryHashEmail(email: string | undefined): string | undefined {
  if (typeof email !== 'string') return undefined
  const trimmed = email.trim()
  if (trimmed.length === 0) return undefined
  return sha256Email(trimmed)
}

function tryHashPhone(phone: string | undefined): string | undefined {
  if (typeof phone !== 'string') return undefined
  const trimmed = phone.trim()
  if (trimmed.length === 0) return undefined
  return sha256Phone(trimmed)
}

/** Build the conversion URN from a numeric id or pass-through if already a URN. */
export function composeConversionUrn(idOrUrn: string): string {
  if (idOrUrn.startsWith('urn:lla:llaPartnerConversion:')) return idOrUrn
  return `urn:lla:llaPartnerConversion:${idOrUrn}`
}

/** Build the userIds array for the request body. Throws if no identifier present. */
export function buildUserIds(user: LinkedinConversionUser): Array<{ idType: string; idValue: string }> {
  const userIds: Array<{ idType: string; idValue: string }> = []

  const emailHash = tryHashEmail(user.email)
  if (emailHash) userIds.push({ idType: 'SHA256_EMAIL', idValue: emailHash })

  const phoneHash = tryHashPhone(user.phone)
  if (phoneHash) userIds.push({ idType: 'SHA256_PHONE', idValue: phoneHash })

  if (typeof user.liFatId === 'string' && user.liFatId.length > 0) {
    userIds.push({ idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: user.liFatId })
  }

  if (typeof user.acxiomId === 'string' && user.acxiomId.length > 0) {
    userIds.push({ idType: 'ACXIOM_ID', idValue: user.acxiomId })
  }

  if (typeof user.oracleMoatId === 'string' && user.oracleMoatId.length > 0) {
    userIds.push({ idType: 'ORACLE_MOAT_ID', idValue: user.oracleMoatId })
  }

  if (userIds.length === 0) {
    throw new Error('buildUserIds: at least one identifier (email, phone, liFatId, or 3p id) must be present')
  }

  return userIds
}

/** Build the full /conversionEvents body. */
export function buildConversionEventBody(
  input: LinkedinConversionEventInput,
  testEventCode?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    conversion: composeConversionUrn(input.conversionId),
    conversionHappenedAt: input.eventTimeMs,
    user: { userIds: buildUserIds(input.user) },
    eventId: input.eventId,
  }

  if (input.value !== undefined) {
    const amountStr =
      typeof input.value.amount === 'string'
        ? input.value.amount
        : input.value.amount.toFixed(2)
    body.conversionValue = { currencyCode: input.value.currencyCode, amount: amountStr }
  }

  if (testEventCode) {
    body.testEventCode = testEventCode
  }

  return body
}

/** Track a conversion event by POSTing to LinkedIn's /rest/conversionEvents. */
export async function trackConversion(
  args: LinkedinCapiCallArgs & { input: LinkedinConversionEventInput },
): Promise<LinkedinCapiResult> {
  const body = buildConversionEventBody(args.input, args.testEventCode)

  const url = `${LINKEDIN_ADS_API_BASE}/conversionEvents`
  const fetchImpl = args.fetchImpl ?? fetch

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.capiAccessToken}`,
      'LinkedIn-Version': args.version ?? LINKEDIN_ADS_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LinkedIn conversionEvents POST failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
  }

  return { ok: true, status: res.status }
}
