// lib/crm/facts/mailbox-evidence.ts
// Parse signature blocks and reply identity from mailbox text.
// Egress-safe: local heuristics only — never sends customer text to third-party search.

import type { Evidence, FactField } from './types'

export interface MailboxFactCandidate {
  field: FactField
  value: string
  evidence: Evidence[]
  method: 'mailbox.signature' | 'mailbox.reply-identity'
}

export interface ParseMailboxEvidenceInput {
  /** Full or partial email body (plain text preferred). */
  bodyText: string
  /** From header display name */
  fromName?: string | null
  /** From header email */
  fromEmail?: string | null
  /** Optional message URL / Gmail permalink for provenance */
  sourceUrl?: string | null
  /** Direction — inbound replies are stronger identity evidence */
  direction?: 'inbound' | 'outbound' | 'unknown'
}

const TITLE_LINE =
  /^(?:title|job title|role|position)\s*[:\-–]\s*(.+)$/i
const PHONE_LINE =
  /^(?:phone|mobile|cell|tel|t|m)\s*[:\-–]?\s*(\+?[\d\s().\-]{7,})$/i
const LINKEDIN_URL =
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/i
const WEBSITE_LINE =
  /^(?:web|website|www)\s*[:\-–]\s*(https?:\/\/\S+|www\.\S+)/i
const DEPT_LINE =
  /^(?:dept|department|team)\s*[:\-–]\s*(.+)$/i

/** Common "Title | Company" or "Title at Company" signature patterns */
const TITLE_AT_COMPANY =
  /^([A-Z][A-Za-z0-9/&\-.,' ]{2,60})\s+(?:at|@|\|)\s+([A-Z][A-Za-z0-9/&\-.,' ]{2,80})$/

const JOB_TITLE_HINT =
  /\b(CEO|CTO|CFO|COO|Founder|Co-Founder|Director|Manager|Head of|VP|Vice President|Partner|Principal|Lead|Engineer|Developer|Designer|Consultant|Advisor|President|Owner|Sales|Marketing|Operations)\b/i

/**
 * Strip quoted reply history so we prefer the writer's own signature.
 */
export function isolateSignatureRegion(bodyText: string): string {
  const text = bodyText.replace(/\r\n/g, '\n')
  const markers = [
    /\nOn .+ wrote:\n/,
    /\n-{2,} ?Original Message ?-{2,}\n/i,
    /\nFrom:\s.+\nSent:\s/i,
    /\n_{5,}\n/,
    /\nGet Outlook for /i,
  ]
  let cut = text.length
  for (const re of markers) {
    const m = re.exec(text)
    if (m && m.index >= 0 && m.index < cut) cut = m.index
  }
  // Prefer last ~25 lines as signature zone
  const head = text.slice(0, cut)
  const lines = head.split('\n')
  if (lines.length > 30) {
    return lines.slice(-25).join('\n')
  }
  return head
}

function pushCandidate(
  out: MailboxFactCandidate[],
  field: FactField,
  value: string,
  kind: Evidence['kind'],
  detail: string,
  sourceUrl?: string | null,
  method: MailboxFactCandidate['method'] = 'mailbox.signature',
) {
  const cleaned = value.trim().replace(/\s+/g, ' ')
  if (!cleaned || cleaned.length < 2) return
  // Dedupe same field+value
  if (out.some((c) => c.field === field && c.value.toLowerCase() === cleaned.toLowerCase())) {
    return
  }
  out.push({
    field,
    value: cleaned.slice(0, 500),
    method,
    evidence: [
      {
        kind,
        detail: detail.slice(0, 500),
        ...(sourceUrl ? { sourceUrl } : {}),
      },
    ],
  })
}

/**
 * Extract CRM fact candidates from mailbox content.
 * Returns candidates only — caller runs recordContactFact for ledger rules.
 */
export function parseMailboxEvidence(input: ParseMailboxEvidenceInput): MailboxFactCandidate[] {
  const body = String(input.bodyText || '')
  if (!body.trim()) return []

  const region = isolateSignatureRegion(body)
  const lines = region
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean)

  const out: MailboxFactCandidate[] = []
  const sourceUrl = input.sourceUrl ?? null
  const isInbound = input.direction === 'inbound'

  // Reply identity: inbound from header is primary-grade when paired with body
  if (isInbound && input.fromName && input.fromName.trim().length >= 2) {
    pushCandidate(
      out,
      'name',
      input.fromName,
      'crm.thread-reply',
      `Inbound reply From display name: ${input.fromName}`,
      sourceUrl,
      'mailbox.reply-identity',
    )
  }

  for (const line of lines) {
    const titleLabeled = TITLE_LINE.exec(line)
    if (titleLabeled?.[1]) {
      pushCandidate(
        out,
        'title',
        titleLabeled[1],
        'crm.signature-block',
        `Signature line: ${line}`,
        sourceUrl,
      )
      continue
    }

    const phoneLabeled = PHONE_LINE.exec(line)
    if (phoneLabeled?.[1]) {
      pushCandidate(
        out,
        'phone',
        phoneLabeled[1].replace(/\s+/g, ' ').trim(),
        'crm.signature-block',
        `Signature phone: ${line}`,
        sourceUrl,
      )
      continue
    }

    const deptLabeled = DEPT_LINE.exec(line)
    if (deptLabeled?.[1]) {
      pushCandidate(
        out,
        'department',
        deptLabeled[1],
        'crm.signature-block',
        `Signature department: ${line}`,
        sourceUrl,
      )
      continue
    }

    const webLabeled = WEBSITE_LINE.exec(line)
    if (webLabeled?.[1]) {
      let url = webLabeled[1].trim()
      if (url.startsWith('www.')) url = `https://${url}`
      pushCandidate(
        out,
        'website',
        url,
        'crm.signature-block',
        `Signature website: ${line}`,
        sourceUrl,
      )
      continue
    }

    const li = LINKEDIN_URL.exec(line)
    if (li?.[0]) {
      pushCandidate(
        out,
        'linkedinUrl',
        li[0].replace(/[).,;]+$/, ''),
        'crm.signature-block',
        `Signature LinkedIn URL: ${li[0]}`,
        sourceUrl,
      )
    }

    const titleAt = TITLE_AT_COMPANY.exec(line)
    if (titleAt?.[1] && titleAt?.[2]) {
      pushCandidate(
        out,
        'title',
        titleAt[1],
        'crm.signature-block',
        `Signature title@company: ${line}`,
        sourceUrl,
      )
      pushCandidate(
        out,
        'employer',
        titleAt[2],
        'crm.signature-block',
        `Signature employer: ${line}`,
        sourceUrl,
      )
      continue
    }

    // Bare job-title-looking line (single line, title keywords, short)
    if (
      line.length <= 60 &&
      JOB_TITLE_HINT.test(line) &&
      !line.includes('@') &&
      !/^https?:/i.test(line)
    ) {
      pushCandidate(
        out,
        'title',
        line,
        'crm.signature-block',
        `Signature title-like line: ${line}`,
        sourceUrl,
      )
    }
  }

  return out
}
