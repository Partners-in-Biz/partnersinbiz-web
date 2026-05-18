// lib/ads/providers/tiktok/audiences-hash.ts
// Server-side normalisation + hashing for TikTok Custom Audience contact
// lists. TikTok requires lowercase-trimmed SHA-256 hex — same normalisation
// rules as Meta + LinkedIn. The output format is different: TikTok expects a
// newline-delimited file of hashes (one per line), not a JSON array.

import { createHash } from 'crypto'

/** Normalise + SHA-256 an email address. Returns lowercase hex string. */
export function sha256Email(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('sha256Email: input must be non-empty string')
  }
  const normalised = raw.trim().toLowerCase()
  return createHash('sha256').update(normalised, 'utf8').digest('hex')
}

/** Normalise + SHA-256 a phone number. Strips spaces/dashes/parens. */
export function sha256Phone(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('sha256Phone: input must be non-empty string')
  }
  // Strip any non-digit (preserve leading + if E.164), then hash.
  const cleaned = raw.replace(/[^\d+]/g, '').toLowerCase()
  if (cleaned.length === 0) throw new Error('sha256Phone: no digits in input')
  return createHash('sha256').update(cleaned, 'utf8').digest('hex')
}

/** Input row for the audience upload — at least one of email/phone must be present. */
export interface AudienceRow {
  email?: string
  phone?: string
}

/**
 * Build newline-delimited hash payload for TikTok upload.
 * Each row produces ONE line per identifier present, so a row with both email
 * + phone produces 2 lines. TikTok's /dmp/custom_audience/file/upload/ expects
 * the file body in this format.
 */
export function rowsToTiktokPayload(rows: AudienceRow[]): string {
  const lines: string[] = []
  for (const row of rows) {
    if (row.email) lines.push(sha256Email(row.email))
    if (row.phone) lines.push(sha256Phone(row.phone))
  }
  return lines.join('\n')
}
