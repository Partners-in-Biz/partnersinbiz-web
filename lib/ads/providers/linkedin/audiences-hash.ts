// lib/ads/providers/linkedin/audiences-hash.ts
// Server-side normalisation + hashing for LinkedIn Matched Audience contact
// lists. LinkedIn requires lowercase-trimmed SHA-256 hex. Mirrors Meta's
// normalisation rules but lives separately for clarity + future divergence.

import { createHash } from 'crypto'

/** Normalise + SHA-256 an email address. Returns lowercase hex string. */
export function sha256Email(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('sha256Email: input must be non-empty string')
  }
  const normalised = raw.trim().toLowerCase()
  return createHash('sha256').update(normalised, 'utf8').digest('hex')
}

/** Normalise + SHA-256 an E.164 phone number. Strips spaces/dashes/parens. */
export function sha256Phone(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('sha256Phone: input must be non-empty string')
  }
  // Strip any non-digit (preserve leading + if E.164), then lowercase the +
  // and hash. LinkedIn accepts E.164 with leading +.
  const cleaned = raw.replace(/[^\d+]/g, '').toLowerCase()
  if (cleaned.length === 0) throw new Error('sha256Phone: no digits in input')
  return createHash('sha256').update(cleaned, 'utf8').digest('hex')
}

/** Input row for the audience upload — at least one of email/phone must be present. */
export interface AudienceRow {
  email?: string
  phone?: string
}

/** Output member shape for the LinkedIn dmpSegments/{id}/users body. */
export interface LinkedinAudienceMember {
  action: 'ADD' | 'REMOVE'
  userIds: Array<{ idType: 'SHA256_EMAIL' | 'SHA256_PHONE'; idValue: string }>
}

/** Convert a single row → LinkedIn member object. Throws if no identifier present. */
export function rowToMember(row: AudienceRow, action: 'ADD' | 'REMOVE' = 'ADD'): LinkedinAudienceMember {
  const userIds: LinkedinAudienceMember['userIds'] = []
  if (row.email) userIds.push({ idType: 'SHA256_EMAIL', idValue: sha256Email(row.email) })
  if (row.phone) userIds.push({ idType: 'SHA256_PHONE', idValue: sha256Phone(row.phone) })
  if (userIds.length === 0) {
    throw new Error('rowToMember: row must have at least email or phone')
  }
  return { action, userIds }
}

/** Default chunk size — LinkedIn caps elements per request. */
export const LINKEDIN_AUDIENCE_CHUNK_SIZE = 5000

/** Chunk an array into batches of N. */
export function chunk<T>(items: T[], size: number = LINKEDIN_AUDIENCE_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error('chunk: size must be > 0')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/** Result of an upload run. */
export interface UploadResult {
  chunksAttempted: number
  chunksSucceeded: number
  chunksFailed: number
  totalMembers: number
  /** First error from any failed chunk, for surfacing. */
  firstError?: string
}

/**
 * Upload audience members to LinkedIn in chunks. Continues on per-chunk
 * failure so a partial upload still reports what landed. Caller decides
 * whether to retry failed chunks (this helper is intentionally simple).
 */
export async function uploadAudienceMembers(args: {
  accessToken: string
  segmentUrn: string  // urn:li:dmpSegment:{id}
  members: LinkedinAudienceMember[]
  chunkSize?: number
  version?: string
  /** Inject a fetch impl for testing (defaults to global fetch). */
  fetchImpl?: typeof fetch
}): Promise<UploadResult> {
  const { accessToken, segmentUrn, members, version } = args
  const chunkSize = args.chunkSize ?? LINKEDIN_AUDIENCE_CHUNK_SIZE
  const fetchImpl = args.fetchImpl ?? fetch

  if (members.length === 0) {
    throw new Error('uploadAudienceMembers: members array is empty')
  }

  // Extract numeric segment id from URN
  const m = segmentUrn.match(/^urn:li:dmpSegment:(.+)$/)
  if (!m) throw new Error(`uploadAudienceMembers: invalid segmentUrn ${segmentUrn}`)
  const segmentId = m[1]

  const { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } = await import('./constants')
  const chunks = chunk(members, chunkSize)

  const result: UploadResult = {
    chunksAttempted: chunks.length,
    chunksSucceeded: 0,
    chunksFailed: 0,
    totalMembers: members.length,
  }

  for (const batch of chunks) {
    try {
      const url = `${LINKEDIN_ADS_API_BASE}/dmpSegments/${encodeURIComponent(segmentId)}/users`
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': version ?? LINKEDIN_ADS_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ elements: batch }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        result.chunksFailed++
        if (!result.firstError) result.firstError = `HTTP ${res.status} — ${text.slice(0, 200)}`
        continue
      }
      result.chunksSucceeded++
    } catch (err) {
      result.chunksFailed++
      if (!result.firstError) result.firstError = (err as Error).message
    }
  }

  return result
}
